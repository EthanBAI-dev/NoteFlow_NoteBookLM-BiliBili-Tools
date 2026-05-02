# Paywall Porter — Onboarding Flow Analysis

> Captured 2026-03-20. Screenshots from user's browser session.

## Overview

Paywall Porter (paywallporter.com) is a competing Chrome extension for importing content into NotebookLM. Their onboarding is notably polished — we want to learn from it for Jetpack's next version.

## Onboarding Flow (9-step guided tour)

### Step 0: Welcome Page (post-install)
- Opens `paywallporter.com/en/onboarding` automatically after install
- Clean, centered layout with brand colors (orange)
- Headline: "Welcome to Paywall Porter"
- Subtitle explains core value prop in one sentence
- Instructs user to **pin the extension** to Chrome toolbar
- Contact email + "Back to Home" link
- Bottom-right: PostHog feedback survey widget ("What can we do to improve our product?")

### Step 1: Popup Welcome Modal
- First time opening the popup → modal overlay appears
- Friendly emoji wave icon
- "Welcome to Paywall Porter!" heading
- Brief description of what it does
- Two CTAs: **Skip** (outline) / **Show Me Around** (filled black)
- Clean, non-intrusive — user can opt out immediately

### Step 2: Feature Tour — Step 1 of 9
- Tooltip/popover pointing at relevant UI elements
- "NotebookLM can't access paywalled content" — explains the problem
- Describes how PP solves it (PDF/text conversion)
- Progress indicator: "1 of 9"
- Navigation: **Next** button

### Step 3: Feature Tour — Step 2 of 9
- "First, Select Your Notebook" — highlights the notebook selector
- Shows the notebook dropdown already populated (same batchexecute API?)
- "Easily find the right notebook from your list, or create a new one."
- Progress: "2 of 9"
- Navigation: **Previous** / **Next**

### Steps 4-9: (not captured)
- Presumably walks through: Add Link, As PDF, 1-Click import, settings, etc.

## Key Design Patterns Worth Adopting

1. **Post-install welcome page**: Automatic tab open with brand + pin instruction
2. **Opt-in guided tour**: Modal with Skip/Start choice — respects user agency
3. **Step-by-step tooltips**: Contextual, pointing at actual UI elements
4. **Progress indicator**: "X of N" so user knows tour length
5. **Previous/Next navigation**: Non-linear, user can go back
6. **PostHog feedback widget**: Lightweight in-app feedback collection

## UI Details

- Brand color: Orange (#E8620A approx)
- Popup width: similar to ours
- Notebook selector: dropdown with edit icon + chevron (very similar to our NotebookSelector)
- Action cards: "Add Link" (NotebookLM), "As PDF", "1-Click" — grid layout
- Bottom nav bar: 5 icons (settings, quick actions, settings, chat, favorites)

## Notes for Jetpack Implementation

- We already have the notebook selector — just need the guided tour overlay
- Consider using a lightweight tour library or building custom tooltip component
- 9 steps might be too many for us — aim for 4-5 focused steps
- Post-install welcome page can be our docs site (jetpack.boing.work/getting-started)
- Skip/dismiss preference should be stored in chrome.storage.local
