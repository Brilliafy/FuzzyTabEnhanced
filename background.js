(function(){
  // Use browser.* if available, fallback to chrome.* for compatibility
  const api = (typeof browser !== 'undefined') ? browser : chrome;
  const DEBUG = false;
  const log = (...args) => { if (!DEBUG) return; try { console.debug('[FuzzyTabs][background]', ...args); } catch (_) {} };
  log('background loaded');

  // Small helpers to deduplicate repeated tab activation code
  function activateTabAndRespond(tabId, sendResponse) {
    try {
      api.tabs.update(tabId, { active: true }, () => {
        const err = api.runtime && api.runtime.lastError;
        if (err) {
          log('tabs.update error', err);
          sendResponse({ ok: false, error: String((err && err.message) || err) });
        } else {
          sendResponse({ ok: true });
        }
      });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  }

  function focusWindowThenActivate(windowId, tabId, sendResponse) {
    try {
      if (typeof windowId === 'number' && api.windows && api.windows.update) {
        api.windows.update(windowId, { focused: true }, () => {
          // ignore possible lastError on focusing
          activateTabAndRespond(tabId, sendResponse);
        });
      } else {
        // No windows API or no windowId, just activate the tab
        activateTabAndRespond(tabId, sendResponse);
      }
    } catch (e) {
      log('error focusing window', e);
      // Try to activate anyway
      activateTabAndRespond(tabId, sendResponse);
    }
  }
  
  // Handle messages from content scripts
  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || !msg.type) return; // not ours
        if (msg.type === 'get-all-tabs') {
          log('get-all-tabs request');
          api.storage.local.get(['tabAccessTimes'], (result) => {
            const accessTimes = result.tabAccessTimes || {};
            api.tabs.query({}, (tabs) => {
              try {
                const data = (tabs || []).map(t => {
                  const lastAcc = accessTimes[t.id] || t.lastAccessed || 0;
                  return {
                    id: t.id,
                    title: t.title,
                    url: t.url,
                    favIconUrl: t.favIconUrl,
                    active: t.active,
                    windowId: t.windowId,
                    lastAccessed: lastAcc
                  };
                });
                sendResponse({ ok: true, tabs: data });
              } catch (e) {
                log('error mapping tabs', e);
                sendResponse({ ok: false, error: String(e) });
              }
            });
          });
          return true; // keep the message channel open for async sendResponse
        } else if (msg.type === 'get-all-bookmarks') {
          log('get-all-bookmarks request');
          try {
            api.storage.local.get(['bookmarkAccessTimes'], (result) => {
              const accessTimes = result.bookmarkAccessTimes || {};
              api.bookmarks.getTree((tree) => {
                try {
                  const items = [];
                  const flatten = (nodes) => {
                    for (const n of nodes) {
                      if (n.url) {
                        items.push({
                          id: n.id,
                          title: n.title,
                          url: n.url,
                          lastAccessed: accessTimes[n.url] || 0
                        });
                      }
                      if (n.children) flatten(n.children);
                    }
                  };
                  flatten(tree || []);
                  sendResponse({ ok: true, bookmarks: items });
                } catch (e) {
                  log('error flattening bookmarks', e);
                  sendResponse({ ok: false, error: String(e) });
                }
              });
            });
            return true;
          } catch (e) {
            log('bookmarks.getTree threw', e);
            sendResponse({ ok: false, error: String(e) });
          }
        } else if (msg.type === 'activate-tab') {
          const tabId = msg && msg.tabId;
          if (typeof tabId === 'number') {
            log('activate-tab request', { tabId });
            try {
              const now = Date.now();
              api.storage.local.get(['tabAccessTimes'], (result) => {
                const accessTimes = result.tabAccessTimes || {};
                accessTimes[tabId] = now;
                api.storage.local.set({ tabAccessTimes: accessTimes }, () => {
                  api.tabs.get(tabId, (tabInfo) => {
                    const getErr = api.runtime && api.runtime.lastError;
                    if (getErr) {
                      log('tabs.get error', getErr);
                      activateTabAndRespond(tabId, sendResponse);
                      return;
                    }
                    const targetWindowId = tabInfo && tabInfo.windowId;
                    focusWindowThenActivate(targetWindowId, tabId, sendResponse);
                  });
                });
              });
              return true; // async
            } catch (e) {
              log('tabs.update threw', e);
              sendResponse({ ok: false, error: String(e) });
            }
          } else {
            sendResponse({ ok: false, error: 'Invalid tabId' });
          }
        } else if (msg.type === 'open-bookmark') {
          const url = msg && msg.url;
          if (typeof url === 'string') {
            log('open-bookmark request', { url });
            try {
              const now = Date.now();
              api.storage.local.get(['bookmarkAccessTimes'], (result) => {
                const accessTimes = result.bookmarkAccessTimes || {};
                accessTimes[url] = now;
                api.storage.local.set({ bookmarkAccessTimes: accessTimes }, () => {
                  api.tabs.create({ url }, (tab) => {
                    const err = api.runtime && api.runtime.lastError;
                    if (err) {
                      log('tabs.create error', err);
                      sendResponse({ ok: false, error: String(err && err.message || err) });
                    } else {
                      sendResponse({ ok: true });
                    }
                  });
                });
              });
              return true; // async
            } catch (e) {
              log('tabs.create threw', e);
              sendResponse({ ok: false, error: String(e) });
            }
          } else {
            sendResponse({ ok: false, error: 'Invalid url' });
          }
        } else if (msg.type === 'close-tab') {
          const tabId = msg && msg.tabId;
          if (typeof tabId === 'number') {
            log('close-tab request', { tabId });
            try {
              api.tabs.remove(tabId, () => {
                const err = api.runtime && api.runtime.lastError;
                if (err) {
                  log('tabs.remove error', err);
                  sendResponse({ ok: false, error: String(err && err.message || err) });
                } else {
                  sendResponse({ ok: true });
                }
              });
              return true; // async
            } catch (e) {
              log('tabs.remove threw', e);
              sendResponse({ ok: false, error: String(e) });
            }
          } else {
            sendResponse({ ok: false, error: 'Invalid tabId' });
          }
        }
      } catch (e) {
        log('onMessage handler error', e);
      }
    });
  }

  if (api && api.commands && api.commands.onCommand) {
    api.commands.onCommand.addListener((command) => {
      if (command === 'open-bookmarks') {
        try {
          api.storage.local.set({ mode: 'bookmarks' }, () => {
            if (api.browserAction && api.browserAction.openPopup) {
              api.browserAction.openPopup();
            }
          });
        } catch (_) {}
      }
    });
  }

  // Active tab tracking listeners
  if (api && api.tabs) {
    if (api.tabs.onActivated) {
      api.tabs.onActivated.addListener((activeInfo) => {
        const tabId = activeInfo.tabId;
        const now = Date.now();
        api.storage.local.get(['tabAccessTimes'], (result) => {
          const accessTimes = result.tabAccessTimes || {};
          accessTimes[tabId] = now;
          api.storage.local.set({ tabAccessTimes: accessTimes });
        });
      });
    }
    if (api.tabs.onRemoved) {
      api.tabs.onRemoved.addListener((tabId) => {
        api.storage.local.get(['tabAccessTimes'], (result) => {
          const accessTimes = result.tabAccessTimes || {};
          delete accessTimes[tabId];
          api.storage.local.set({ tabAccessTimes: accessTimes });
        });
      });
    }
    // Initialize access time for currently active tab
    try {
      api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          const tabId = tabs[0].id;
          api.storage.local.get(['tabAccessTimes'], (result) => {
            const accessTimes = result.tabAccessTimes || {};
            accessTimes[tabId] = Date.now();
            api.storage.local.set({ tabAccessTimes: accessTimes });
          });
        }
      });
    } catch (_) {}
  }
})();
