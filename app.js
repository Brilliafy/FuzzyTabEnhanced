(function() {
  const DEBUG = false;
  const log = (...args) => { if (!DEBUG) return; try { console.debug('[FuzzyTabs][content]', ...args); } catch (_) {} };
  log('content script loaded', { url: location.href });

  // State for results navigation
  const STATE = { allTabs: [], allBookmarks: [], mode: 'tabs', tabs: [], focusedIndex: -1, query: '', allowMouseFocus: false };

  function getUIElements() {
    const input = document.getElementById("fuzzy-tabs-input");
    const ul = document.querySelector('.fsl-results');
    const modeIcon = document.getElementById("fsl-mode-icon");
    return { input, ul, modeIcon };
  }

  const ICON_TAB = `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M1 3.5A1.5 1.5 0 012.5 2h11A1.5 1.5 0 0115 3.5v9a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9zM2.5 3a.5.5 0 00-.5.5V11h12V3.5a.5.5 0 00-.5-.5h-11z"/></svg>`;
  const ICON_STAR = `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/></svg>`;
  const ICON_CLOCK = `<svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 15A7 7 0 118 1a7 7 0 010 14zm0-1A6 6 0 108 2a6 6 0 000 12zm.5-6.5V4a.5.5 0 00-1 0v4a.5.5 0 00.25.433l3 1.75a.5.5 0 00.5-.866L8.5 7.5z" fill="currentColor"/></svg>`;

  function normalizeText(string) {
    if (!string) return '';
    return string
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ł/g, 'l')
      .replace(/ñ/g, 'n')
      .trim();
  }

  function fuzzyMatchFzf(text, query) {
    if (!query) return { isMatch: true, score: 0, ranges: [] };
    
    const textLower = normalizeText(text);
    const queryLower = normalizeText(query);
    
    // 1. Exact substring match
    const subIdx = textLower.indexOf(queryLower);
    if (subIdx !== -1) {
      let score = 10;
      // Word boundary bonus
      const isWordStart = subIdx === 0 || /[\s\-\_\.\/\:\?\&\=]/.test(textLower[subIdx - 1]);
      if (isWordStart) {
        score -= 5;
      }
      // Index position penalty
      score += (subIdx / textLower.length) * 2;
      
      return {
        isMatch: true,
        score: score,
        ranges: [[subIdx, subIdx + query.length - 1]]
      };
    }
    
    // 2. Subsequence match
    let qIdx = 0;
    let tIdx = 0;
    const matchIndices = [];
    
    while (tIdx < textLower.length && qIdx < queryLower.length) {
      if (textLower[tIdx] === queryLower[qIdx]) {
        matchIndices.push(tIdx);
        qIdx++;
      }
      tIdx++;
    }
    
    if (qIdx < queryLower.length) {
      return { isMatch: false, score: Infinity, ranges: [] };
    }
    
    let score = 50; // base fuzzy score
    const ranges = [];
    let lastIdx = -2;
    for (const idx of matchIndices) {
      if (idx === lastIdx + 1) {
        ranges[ranges.length - 1][1] = idx;
      } else {
        ranges.push([idx, idx]);
      }
      lastIdx = idx;
    }
    
    const span = matchIndices[matchIndices.length - 1] - matchIndices[0] + 1;
    const spanPenalty = (span - query.length) * 0.5;
    score += spanPenalty;
    score += (ranges.length - 1) * 3;
    
    let wordBoundaries = 0;
    for (const idx of matchIndices) {
      if (idx === 0 || /[\s\-\_\.\/\:\?\&\=]/.test(textLower[idx - 1])) {
        wordBoundaries++;
      }
    }
    score -= wordBoundaries * 2;
    
    return {
      isMatch: true,
      score: score,
      ranges: ranges
    };
  }

  function scoreItem(item, queryText) {
    const queryTerms = queryText.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (queryTerms.length === 0) {
      return { item, score: 0, matches: [null, null] };
    }
    
    const title = item.title || '';
    const url = item.url || '';
    
    let totalScore = 0;
    const titleRanges = [];
    const urlRanges = [];
    
    for (const term of queryTerms) {
      const titleMatch = fuzzyMatchFzf(title, term);
      const urlMatch = fuzzyMatchFzf(url, term);
      
      if (titleMatch.isMatch && urlMatch.isMatch) {
        totalScore += Math.min(titleMatch.score, urlMatch.score) - 2;
        titleRanges.push(...titleMatch.ranges);
        urlRanges.push(...urlMatch.ranges);
      } else if (titleMatch.isMatch) {
        totalScore += titleMatch.score;
        titleRanges.push(...titleMatch.ranges);
      } else if (urlMatch.isMatch) {
        totalScore += urlMatch.score + 15;
        urlRanges.push(...urlMatch.ranges);
      } else {
        return null;
      }
    }
    
    // Apply recency bonus
    const lastAccessed = item.lastAccessed || 0;
    if (lastAccessed > 0) {
      const ageMs = Date.now() - lastAccessed;
      const ageMin = ageMs / 60000;
      let recencyBonus = 0;
      if (ageMin < 1) recencyBonus = 12;
      else if (ageMin < 10) recencyBonus = 10;
      else if (ageMin < 60) recencyBonus = 8;
      else if (ageMin < 1440) recencyBonus = 6;
      else if (ageMin < 10080) recencyBonus = 3;
      else if (ageMin < 43200) recencyBonus = 1;
      
      totalScore -= recencyBonus;
    }
    
    const mergeRanges = (ranges) => {
      if (ranges.length === 0) return [];
      ranges.sort((a, b) => a[0] - b[0]);
      const merged = [ranges[0]];
      for (let i = 1; i < ranges.length; i++) {
        const last = merged[merged.length - 1];
        const curr = ranges[i];
        if (curr[0] <= last[1] + 1) {
          last[1] = Math.max(last[1], curr[1]);
        } else {
          merged.push(curr);
        }
      }
      return merged;
    };
    
    return {
      item,
      score: totalScore,
      matches: [
        titleRanges.length > 0 ? mergeRanges(titleRanges) : null,
        urlRanges.length > 0 ? mergeRanges(urlRanges) : null
      ]
    };
  }

  function createFuzzySearch(collection) {
    return function(queryText) {
      const results = [];
      for (const item of collection) {
        const res = scoreItem(item, queryText);
        if (res) {
          results.push(res);
        }
      }
      results.sort((a, b) => a.score - b.score);
      return results;
    };
  }

  function updateModeUI() {
    const { input, modeIcon } = getUIElements();
    if (input) {
      input.placeholder = STATE.mode === 'tabs' ? 'Search tabs...' : 'Search bookmarks...';
      setTimeout(() => input.focus(), 50);
    }
    if (modeIcon) {
      modeIcon.innerHTML = STATE.mode === 'tabs' ? ICON_TAB : ICON_STAR;
      modeIcon.title = STATE.mode === 'tabs' ? 'Tab mode' : 'Bookmark mode';
    }
  }

  function toggleMode() {
    STATE.mode = STATE.mode === 'tabs' ? 'bookmarks' : 'tabs';
    updateModeUI();
    if (STATE.mode === 'tabs') {
      fetchAllTabsAndRender();
    } else {
      fetchAllBookmarksAndRender();
    }
  }

  function fetchAllBookmarksAndRender() {
    try {
      const api = (typeof browser !== 'undefined') ? browser : chrome;
      api.runtime.sendMessage({ type: 'get-all-bookmarks' }, (resp) => {
        try {
          if (resp && resp.ok && Array.isArray(resp.bookmarks)) {
            log('received bookmarks list', { count: resp.bookmarks.length });
            STATE.allBookmarks = resp.bookmarks.slice();
            computeResultsAndRender();
          } else {
            log('unexpected response for get-all-bookmarks', resp);
            STATE.allBookmarks = [];
            computeResultsAndRender();
          }
        } catch (e) {
          log('error handling bookmarks response', e);
        }
      });
    } catch (e) {
      log('failed to request get-all-bookmarks', e);
    }
  }

  function setFocusedIndex(newIndex) {
    const { ul } = getUIElements();
    const items = ul ? Array.from(ul.querySelectorAll('li')) : [];
    if (!items.length) { STATE.focusedIndex = -1; return; }
    const max = items.length - 1;
    newIndex = Math.max(0, Math.min(max, newIndex));
    // Remove previous
    if (STATE.focusedIndex >= 0 && items[STATE.focusedIndex]) {
      items[STATE.focusedIndex].classList.remove('focused');
    }
    // Add to new
    STATE.focusedIndex = newIndex;
    const li = items[newIndex];
    if (li) {
      li.classList.add('focused');
      try { li.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    }
  }

  function moveFocus(delta) {
    const { ul } = getUIElements();
    const items = ul ? Array.from(ul.querySelectorAll('li')) : [];
    if (!items.length) return;
    const next = STATE.focusedIndex < 0 ? 0 : STATE.focusedIndex + delta;
    setFocusedIndex(next);
  }

  function activateTabById(tabId) {
    try {
      const api = (typeof browser !== 'undefined') ? browser : chrome;
      api.runtime.sendMessage({ type: 'activate-tab', tabId }, (resp) => {
        // On success, close window (extension page) or overlay otherwise
        if (resp && resp.ok) {
          closeExtensionWindow();
        }
      });
    } catch (_) {}
  }

  function openBookmark(url) {
    try {
      const api = (typeof browser !== 'undefined') ? browser : chrome;
      api.runtime.sendMessage({ type: 'open-bookmark', url }, (resp) => {
        if (resp && resp.ok) {
          closeExtensionWindow();
        }
      });
    } catch (_) {}
  }

  function buildHighlightedSpan(text, ranges) {
    const span = document.createElement('span');
    let pos = 0;
    for (const [a, b] of ranges) {
      if (a > pos) span.appendChild(document.createTextNode(text.slice(pos, a)));
      const mark = document.createElement('span');
      mark.className = 'fsl-hl';
      mark.textContent = text.slice(a, b + 1);
      span.appendChild(mark);
      pos = b + 1;
    }
    if (pos < text.length) span.appendChild(document.createTextNode(text.slice(pos)));
    return span;
  }

  function computeResultsAndRender() {
    const { ul, input } = getUIElements();
    if (!ul) return;
    const q = (input && input.value || '').trim();
    STATE.query = q;

    const sourceData = STATE.mode === 'tabs' ? STATE.allTabs : STATE.allBookmarks;

    if (!q) {
        // No query: show all items sorted by recency
        const sortedItems = sourceData
            .slice()
            .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
            .map(x => ({item: x}));
        renderItems(sortedItems);
        return;
    }

    const fuzzySearch = createFuzzySearch(sourceData);
    const fuzzySearchResults = fuzzySearch(q);
    renderItems(fuzzySearchResults);
  }

  function renderItems(items) {
    try {
      const { ul } = getUIElements();
      if (!ul) return;
      ul.innerHTML = '';

      STATE.tabs = items.map(n => n.item);
      STATE.focusedIndex = -1;

      // Update counter
      const counterEl = document.getElementById("fsl-counter");
      if (counterEl) {
        const total = STATE.mode === 'tabs' ? STATE.allTabs.length : STATE.allBookmarks.length;
        counterEl.textContent = `${items.length}/${total}`;
      }

      if (!items.length) {
        const li = document.createElement('li');
        li.textContent = STATE.query ? 'No results' : (STATE.mode === 'tabs' ? 'No tabs available' : 'No bookmarks available');
        li.style.color = 'rgba(255,255,255,0.6)';
        ul.appendChild(li);
        return;
      }

      for (let i = 0; i < items.length; i++) {
        const { item: t, matches } = items[i];
        const li = document.createElement('li');
        if (STATE.mode === 'tabs') {
          li.setAttribute('data-tab-id', String(t.id));
        } else {
          li.setAttribute('data-url', t.url);
        }
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');

        // small arrow indicator (hidden unless focused)
        const arrow = document.createElement('span');
        arrow.className = 'fsl-arrow';
        arrow.textContent = '▸';

        // favicon
        const img = document.createElement('img');
        img.className = 'fsl-fav';
        img.alt = '';
        img.decoding = 'async';

        // Helper: check if favicon URL is safe to load in a content page
        const isSafeFaviconUrl = (url) => {
          if (!url || typeof url !== 'string') return false;
          // Block chrome://, about://, resource:// and similar internal schemes
          if (/^(chrome|about|resource|moz-icon):/i.test(url)) return false;
          // Allow http(s) and data URIs; also allow extension's own moz-extension URLs
          if (/^(https?:|data:|moz-extension:)/i.test(url)) return true;
          return false;
        };
        const getDefaultIconUrl = () => {
          try {
            const api = (typeof browser !== 'undefined') ? browser : chrome;
            if (api && api.runtime && typeof api.runtime.getURL === 'function') {
              return api.runtime.getURL('icons/ic_search.svg');
            }
          } catch (_) {}
          return null;
        };

        // Prefer tabs API favicon; fallback to origin favicon.ico if available
        let favicon = t.favIconUrl;
        try {
          if (!favicon && t.url) {
            const u = new URL(t.url);
            if (u.origin && u.origin !== 'null' && /^https?:$/i.test(u.protocol)) {
              favicon = u.origin + '/favicon.ico';
            }
          }
        } catch (_) {}
        // If favicon is unsafe (e.g., chrome://mozapps/.../extension.svg), use default icon
        if (!isSafeFaviconUrl(favicon)) {
          favicon = getDefaultIconUrl();
        }
        if (favicon) img.src = favicon;
        img.style.visibility = 'hidden';
        img.addEventListener('load', () => { img.style.visibility = 'visible'; });

        // title and url with highlight
        const titleSpan = document.createElement('span');
        titleSpan.className = 'fsl-title';
        const titleText = (t.title && t.title.trim()) ? t.title : (t.url || 'Untitled');
        if (STATE.query && matches && matches[0]) {
          const titleMatches = matches[0]
          titleSpan.appendChild(buildHighlightedSpan(titleText, titleMatches));
        } else {
          titleSpan.textContent = titleText;
        }

        const urlSpan = document.createElement('span');
        urlSpan.className = 'fsl-url';
        const urlText = t.url || '';
        if (STATE.query && matches && matches[1]) {
          const urlMatches = matches[1]
          urlSpan.appendChild(buildHighlightedSpan(urlText, urlMatches));
        } else {
          urlSpan.textContent = urlText;
        }

        li.appendChild(arrow);
        li.appendChild(img);
        li.appendChild(titleSpan);
        li.appendChild(urlSpan);

        // clock icon for recently accessed items (within 24 hours)
        const isRecent = t.lastAccessed && (Date.now() - t.lastAccessed < 3600000 * 24);
        if (isRecent) {
          const clockSpan = document.createElement('span');
          clockSpan.className = 'fsl-recent-badge';
          clockSpan.innerHTML = ICON_CLOCK;
          
          const elapsed = Date.now() - t.lastAccessed;
          const mins = Math.round(elapsed / 60000);
          if (mins < 60) {
            clockSpan.title = `Accessed ${mins}m ago`;
          } else {
            const hrs = Math.round(mins / 60);
            clockSpan.title = `Accessed ${hrs}h ago`;
          }
          li.appendChild(clockSpan);
        }

        if (STATE.mode === 'tabs') {
          // close (cross) button on the right
          const closeBtn = document.createElement('button');
          closeBtn.className = 'fsl-close';
          closeBtn.type = 'button';
          // SVG cross icon
          // Ensure the cross is visible by explicitly disabling fill and using rounded joins
          closeBtn.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3 L9 9 M9 3 L3 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
          // Tooltip with platform-specific hotkey
          const isMac = navigator.platform && /Mac/i.test(navigator.platform);
          closeBtn.title = isMac ? 'Ctrl+W' : 'Alt+W';
          // Prevent list item activation and focus changes on clicking cross
          const handleClose = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const tabId = t.id;
            if (typeof tabId !== 'number') return;
            try {
              const api = (typeof browser !== 'undefined') ? browser : chrome;
              api.runtime.sendMessage({ type: 'close-tab', tabId }, () => {
                try {
                  // Remove li and update state similarly to keyboard path
                  const currentUl = ul;
                  li.remove();
                  const remaining = Array.from(currentUl.querySelectorAll('li'));
                  STATE.tabs = STATE.tabs.filter(tt => tt.id !== tabId);
                  STATE.allTabs = STATE.allTabs.filter(tt => tt.id !== tabId);
                  if (remaining.length > 0) {
                    const idx = Math.min(STATE.focusedIndex, remaining.length - 1);
                    STATE.focusedIndex = -1;
                    setFocusedIndex(idx);
                  } else {
                    computeResultsAndRender();
                  }
                } catch (_) {}
              });
            } catch (_) {}
          };
          closeBtn.addEventListener('click', handleClose);

          li.appendChild(closeBtn);
        }

        // interactions: hover moves focus (only when mouse focus is enabled); click/mousedown activates
        li.addEventListener('mouseenter', () => {
          if (!STATE.allowMouseFocus) return;
          const idx = Array.prototype.indexOf.call(ul.children, li);
          setFocusedIndex(idx);
        });

        const handleActivate = (ev) => {
          try {
            // Only react to primary button and ignore clicks on the close button
            if (ev.button !== 0) return;
            if (ev.target && ev.target.closest && ev.target.closest('.fsl-close')) return;
            ev.preventDefault();
            if (STATE.mode === 'tabs') {
              const tabId = t.id;
              if (tabId != null) activateTabById(tabId);
            } else {
              const url = t.url;
              if (url != null) openBookmark(url);
            }
          } catch (_) {}
        };
        // Activate early on mousedown to avoid input blur closing the overlay before click fires
        li.addEventListener('mousedown', handleActivate);
        // Fallback activation on click (in case mousedown was prevented by the page)
        li.addEventListener('click', handleActivate);

        ul.appendChild(li);
      }
      // initialize focus to the first item
      setFocusedIndex(0);
    } catch (e) {
      log('renderTabsList error', e);
    }
  }

  function fetchAllTabsAndRender() {
    try {
      const api = (typeof browser !== 'undefined') ? browser : chrome;
      api.runtime.sendMessage({ type: 'get-all-tabs' }, (resp) => {
        try {
          if (resp && resp.ok && Array.isArray(resp.tabs)) {
            log('received tabs list', { count: resp.tabs.length });
            STATE.allTabs = resp.tabs.slice();
            computeResultsAndRender();
          } else {
            log('unexpected response for get-all-tabs', resp);
            STATE.allTabs = [];
            computeResultsAndRender();
          }
        } catch (e) {
          log('error handling tabs response', e);
        }
      });
    } catch (e) {
      log('failed to request get-all-tabs', e);
    }
  }

  function initApp() {
    log('initApp');
    // On open, require a fresh mouse move to enable hover focusing
    STATE.allowMouseFocus = false;
    const { input } = getUIElements();
    if (input) {
      log('focusing input');
      input.value = '';
      input.placeholder = STATE.mode === 'tabs' ? 'Search tabs...' : 'Search bookmarks...';
      setTimeout(() => input.focus(), 50);
      input.addEventListener('input', () => computeResultsAndRender());
    }

    const { modeIcon } = getUIElements();
    if (modeIcon) {
      modeIcon.addEventListener('click', () => toggleMode());
    }

    // Enable mouse-driven focusing after actual mouse movement
    document.addEventListener('mousemove', () => {
      STATE.allowMouseFocus = true;
    }, true);

    // Close window when it loses focus (mimics rofi overlay)
    window.addEventListener('blur', () => {
      closeExtensionWindow();
    });

    // Keyboard handling on the app page
    document.addEventListener('keydown', (e) => {
      // Any key press disables mouse-driven focusing until the mouse moves again
      STATE.allowMouseFocus = false;
      if (e.key === 'Escape') {
        log('Escape pressed, closing');
        e.preventDefault();
        closeExtensionWindow();
        return;
      }
      if (e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'n' || e.key === 'N' || e.key === 'j' || e.key === 'J'))) {
        e.preventDefault();
        moveFocus(1);
        return;
      }
      if (e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'p' || e.key === 'P' || e.key === 'k' || e.key === 'K'))) {
        e.preventDefault();
        moveFocus(-1);
        return;
      }
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        closeExtensionWindow();
        return;
      }
      if (e.key === 'Enter') {
        // Activate the focused item
        const { ul } = getUIElements();
        if (!ul) return;
        const items = Array.from(ul.querySelectorAll('li'));
        if (STATE.focusedIndex >= 0 && items[STATE.focusedIndex]) {
          const li = items[STATE.focusedIndex];
          if (STATE.mode === 'tabs') {
            const tabId = li && li.getAttribute('data-tab-id');
            if (tabId) {
              e.preventDefault();
              activateTabById(parseInt(tabId, 10));
            }
          } else {
            const url = li && li.getAttribute('data-url');
            if (url) {
              e.preventDefault();
              openBookmark(url);
            }
          }
        }
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        toggleMode();
        return;
      }
      // Ctrl/Cmd+W closes the focused tab from the list (not the browser tab)
      const isMac = navigator.platform && /Mac/i.test(navigator.platform);
      if ((e.key === 'w' || e.key === 'W') && (e.ctrlKey && isMac || e.altKey && !isMac)) {
        if (STATE.mode !== 'tabs') return;
        const { ul } = getUIElements();
        if (!ul) return;
        const items = Array.from(ul.querySelectorAll('li'));
        if (STATE.focusedIndex >= 0 && items[STATE.focusedIndex]) {
          const li = items[STATE.focusedIndex];
          const tabIdStr = li && li.getAttribute('data-tab-id');
          if (tabIdStr) {
            e.preventDefault();
            e.stopPropagation();
            const tabId = parseInt(tabIdStr, 10);
            try {
              const api = (typeof browser !== 'undefined') ? browser : chrome;
              api.runtime.sendMessage({ type: 'close-tab', tabId }, (resp) => {
                // Optimistically remove the item from the list
                try {
                  li.remove();
                  const remaining = Array.from(ul.querySelectorAll('li'));
                  // Update STATE.tabs and STATE.allTabs to reflect removal
                  STATE.tabs = STATE.tabs.filter(t => t.id !== tabId);
                  STATE.allTabs = STATE.allTabs.filter(t => t.id !== tabId);
                  // Adjust focus to a sensible item
                  if (remaining.length > 0) {
                    const nextIndex = Math.min(STATE.focusedIndex, remaining.length - 1);
                    STATE.focusedIndex = -1; // will be set by setFocusedIndex
                    setFocusedIndex(nextIndex);
                  } else {
                    // No items left; show empty message
                    computeResultsAndRender();
                  }
                } catch (_) {}
              });
            } catch (_) {}
          }
        }
      }
    }, true);

    // Load mode and items
    try {
      const api = (typeof browser !== 'undefined') ? browser : chrome;
      api.storage.local.get('mode', (res) => {
        if (res && res.mode === 'bookmarks') {
          STATE.mode = 'bookmarks';
          fetchAllBookmarksAndRender();
        } else {
          STATE.mode = 'tabs';
          fetchAllTabsAndRender();
        }
        updateModeUI();
        api.storage.local.remove('mode');
      });
    } catch (_) {
      updateModeUI();
      fetchAllTabsAndRender();
    }
  }

  // Close the extension window
  function closeExtensionWindow() {
    try { window.close(); } catch (_) {}
  }

  initApp();
})();