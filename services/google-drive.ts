/**
 * Google Drive API integration service.
 *
 * Uploads Markdown files to the user's Google Drive so they can be
 * imported into NotebookLM via the native Drive source picker.
 *
 * Requirements:
 *   - Chrome extension with 'identity' permission
 *   - OAuth2 client_id configured in manifest
 *   - Scope: https://www.googleapis.com/auth/drive.file
 */

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

const KAPTURE_FOLDER_NAME = 'Kapture_Notes';

export interface DriveAuthResult {
  success: boolean;
  token?: string;
  error?: string;
}

export interface DriveUploadResult {
  success: boolean;
  fileId?: string;
  fileName?: string;
  webViewLink?: string;
  error?: string;
}

let cachedToken: string | null = null;
let tokenExpiry = 0;

/**
 * Get an OAuth2 token for Google Drive API access.
 * Uses chrome.identity.getAuthToken with interactive: false first,
 * falls back to interactive: true if needed.
 */
export async function getDriveAuthToken(interactive = false): Promise<DriveAuthResult> {
  if (cachedToken && Date.now() < tokenExpiry) {
    return { success: true, token: cachedToken };
  }

  try {
    const token = await new Promise<string>((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (t) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!t) {
          reject(new Error('No token returned'));
        } else {
          resolve(t);
        }
      });
    });

    cachedToken = token;
    tokenExpiry = Date.now() + 50 * 60 * 1000;
    return { success: true, token };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown auth error';

    if (!interactive && msg.includes('interactive')) {
      return getDriveAuthToken(true);
    }

    return { success: false, error: msg };
  }
}

/**
 * Remove cached token (call on auth failure to force re-auth).
 */
export async function revokeDriveToken(): Promise<void> {
  if (cachedToken) {
    try {
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${cachedToken}`);
    } catch { /* ignore */ }
    cachedToken = null;
    tokenExpiry = 0;
  }

  try {
    await new Promise<void>((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (token) {
          chrome.identity.removeCachedAuthToken({ token }, () => resolve());
        } else {
          resolve();
        }
      });
    });
  } catch { /* ignore */ }
}

/**
 * Find or create the Kapture_Notes folder in the user's Drive.
 */
async function findOrCreateKaptureFolder(token: string): Promise<string> {
  const query = encodeURIComponent(
    `name='${KAPTURE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const resp = await fetch(
    `${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) {
    throw new Error(`Drive folder query failed: HTTP ${resp.status}`);
  }

  const data = await resp.json() as { files?: { id: string; name: string }[] };
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  const createResp = await fetch(
    `${DRIVE_API_BASE}/files`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: KAPTURE_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    }
  );

  if (!createResp.ok) {
    throw new Error(`Drive folder creation failed: HTTP ${createResp.status}`);
  }

  const created = await createResp.json() as { id: string };
  return created.id;
}

/**
 * Upload a Markdown file to Google Drive.
 *
 * Uses multipart upload: metadata (JSON) + file content.
 * The file is created in the Kapture_Notes folder with a distinctive name
 * so it appears at the top of "Recent" in the NotebookLM Drive picker.
 */
export async function uploadToDrive(
  content: string,
  fileName: string,
): Promise<DriveUploadResult> {
  try {
    const auth = await getDriveAuthToken(false);
    if (!auth.success || !auth.token) {
      return { success: false, error: auth.error || '授权失败' };
    }

    const token = auth.token;
    const folderId = await findOrCreateKaptureFolder(token);

    const safeName = fileName
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    const displayName = `🔥 ${safeName}`;

    const boundary = `kapture_boundary_${Date.now()}`;
    const metadata = {
      name: `${displayName}.md`,
      mimeType: 'text/markdown',
      parents: [folderId],
    };

    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/markdown; charset=UTF-8',
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');

    const uploadResp = await fetch(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,webViewLink`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );

    if (!uploadResp.ok) {
      const errText = await uploadResp.text();
      console.error('[Drive] Upload failed:', uploadResp.status, errText);

      if (uploadResp.status === 401) {
        cachedToken = null;
        tokenExpiry = 0;
        return { success: false, error: '授权已失效，请重新授权' };
      }

      return { success: false, error: `上传失败 (HTTP ${uploadResp.status})` };
    }

    const result = await uploadResp.json() as { id: string; name: string; webViewLink: string };

    return {
      success: true,
      fileId: result.id,
      fileName: displayName,
      webViewLink: result.webViewLink,
    };
  } catch (err) {
    console.error('[Drive] Upload error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : '上传失败',
    };
  }
}
