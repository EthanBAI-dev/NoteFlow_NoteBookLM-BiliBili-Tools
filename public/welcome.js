const locale = navigator.language && navigator.language.startsWith('zh') ? 'zh' : 'en';

const messages = {
  zh: {
    title: 'NoteFlow — 欢迎',
    pinToastTitle: 'NoteFlow 已安装',
    pinToastDesc1: '点击浏览器工具栏右侧的拼图图标，将 NoteFlow 固定到工具栏以便快速使用',
    pinToastDesc2: '固定后即可更快打开扩展并开始导入。',
    heroSub: '将哔哩哔哩、YouTube、播客、网页、AI 对话等内容一键导入 NotebookLM，高效构建你的知识库。',
    featuresLabel: '核心能力',
    feature1Title: '哔哩哔哩字幕',
    feature1Desc: '导入 Bilibili 视频字幕与弹幕，亦可一键导出为 TXT 格式，便于本地存档与二次加工。',
    feature1Tag1: '字幕导入',
    feature1Tag2: 'TXT 导出',
    feature2Title: 'YouTube 与播客导入',
    feature2Desc: '粘贴 YouTube 视频链接或小宇宙播客链接，自动提取内容列表，勾选批量导入 NotebookLM。',
    feature2Tag1: 'YouTube',
    feature2Tag2: '小宇宙',
    feature3Title: '网页内容导入',
    feature3Desc: '自动列出当前浏览器所有窗口的标签页，按窗口分组展示，勾选后一键导入 NotebookLM。',
    feature3Tag1: '浏览器标签页',
    feature3Tag2: 'URL',
    feature4Title: 'AI 对话导入',
    feature4Desc: '提取 Claude、ChatGPT、Gemini 的对话记录，以问答对为单位勾选，导入至 NotebookLM 深度分析。',
    feature5Title: '账号体系',
    feature5Desc: '支持 Google 多账号快速切换，自动检测当前 NotebookLM 激活账号，自由选择目标笔记本。',
    feature5Tag1: 'Google 账号',
    feature5Tag2: '自动检测',
    feature5Tag3: '多笔记本',
    feature6Title: '后台批量导入',
    feature6Desc: '无需打开新标签页，在列表中选中多条内容，后台批量写入 NotebookLM，进度实时显示。',
    feature6Tag1: '批量',
    feature6Tag2: '后台',
    workflowLabel: '使用流程',
    step1Label: '选择来源',
    step1Desc: '切换到对应功能面板',
    step2Label: '选取内容',
    step2Desc: '勾选需要导入的视频、网页或对话',
    step3Label: '一键导入',
    step3Desc: '点击底部按钮，后台自动完成',
    step4Desc: '在 NotebookLM 中阅读与整理',
    footerTagline: '开源 · 免费 · 为知识工作者而生',
  },
  en: {
    title: 'NoteFlow — Welcome',
    pinToastTitle: 'NoteFlow is installed',
    pinToastDesc1: 'Click the puzzle icon on the right side of your browser toolbar to pin NoteFlow for quick access.',
    pinToastDesc2: 'Once pinned, you can open the extension and start importing faster.',
    heroSub: 'Import content from Bilibili, YouTube, podcasts, web pages, AI chats, and more into NotebookLM in one click to build your knowledge base faster.',
    featuresLabel: 'Core Features',
    feature1Title: 'Bilibili Subtitles',
    feature1Desc: 'Import Bilibili subtitles and danmaku, or export them as TXT files for local archiving and reuse.',
    feature1Tag1: 'Subtitle Import',
    feature1Tag2: 'TXT Export',
    feature2Title: 'YouTube & Podcast Import',
    feature2Desc: 'Paste a YouTube or Xiaoyuzhou link, fetch the content list automatically, and batch import selected items into NotebookLM.',
    feature2Tag1: 'YouTube',
    feature2Tag2: 'Xiaoyuzhou',
    feature3Title: 'Web Page Import',
    feature3Desc: 'List tabs from all browser windows, group them by window, and import selected pages into NotebookLM in one click.',
    feature3Tag1: 'Browser Tabs',
    feature3Tag2: 'URL',
    feature4Title: 'AI Chat Import',
    feature4Desc: 'Extract conversations from Claude, ChatGPT, and Gemini, select Q&A pairs, and import them into NotebookLM for deeper analysis.',
    feature5Title: 'Account System',
    feature5Desc: 'Switch between multiple Google accounts quickly, detect the active NotebookLM account automatically, and choose the right notebook with ease.',
    feature5Tag1: 'Google Accounts',
    feature5Tag2: 'Auto Detection',
    feature5Tag3: 'Multiple Notebooks',
    feature6Title: 'Background Batch Import',
    feature6Desc: 'Select multiple items from a list and import them into NotebookLM in the background without opening extra tabs.',
    feature6Tag1: 'Batch',
    feature6Tag2: 'Background',
    workflowLabel: 'Workflow',
    step1Label: 'Choose Source',
    step1Desc: 'Switch to the matching feature panel',
    step2Label: 'Select Content',
    step2Desc: 'Choose the videos, pages, or chats you want to import',
    step3Label: 'Import in One Click',
    step3Desc: 'Use the action button and let the background flow finish the job',
    step4Desc: 'Read, organize, and build knowledge in NotebookLM',
    footerTagline: 'Open source · Free · Built for knowledge workers',
  },
};

function applyLocale() {
  const dict = messages[locale];
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = dict.title;

  Object.entries(dict).forEach(([id, value]) => {
    if (id === 'title') return;
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });
}

function enableToast() {
  const closeButton = document.getElementById('pinToastClose');
  const toast = document.getElementById('pinToast');
  if (!closeButton || !toast) return;

  closeButton.addEventListener('click', () => {
    toast.classList.add('hidden');
  });
}

function enableReveal() {
  const elements = document.querySelectorAll('.reveal');
  if (!elements.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
  );

  elements.forEach((el, i) => {
    el.style.transitionDelay = `${(i % 6) * 50}ms`;
    observer.observe(el);
  });

  window.setTimeout(() => {
    const hero = document.querySelector('.hero');
    if (hero) hero.classList.add('visible');
  }, 80);
}

applyLocale();
enableToast();
enableReveal();
