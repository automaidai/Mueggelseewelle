const { chromium } = require('playwright');
const fs = require('node:fs/promises');

const sites = [
  { name: 'Müggelseewelle', url: 'https://mueggelseewelle.de/', selectors: ['button[aria-label="Live-Radio abspielen"]', 'button.play-toggle'], mediaId: 'radio' },
  { name: 'RadioKing', url: 'https://play.radioking.io/muggelseewelle', native: true },
  { name: 'TuneIn', url: 'https://tunein.com/radio/M%C3%BCggelseewelle---The-Lake-s354322/', selectors: ['[data-testid="profilePlayerActionButton"]'] },
  { name: 'radio.de', url: 'https://www.radio.de/s/mueggelseewelle', selectors: ['button[aria-label*="Abspielen"]', 'button[aria-label*="Play"]', '[data-testid="play-button"]'] },
  { name: 'Online Radio Box', url: 'https://onlineradiobox.com/de/muggelseewelle/', selectors: ['button.station_play'] },
  { name: 'phonostar', url: 'https://www.phonostar.de/radio/mueggelseewelle-thelake', selectors: ['a:has-text("Jetzt anhören")'] },
  { name: 'welove.radio', url: 'https://welove.radio/radio/muggelseewelle/', selectors: ['button:has(svg[data-icon="play"])'] },
];

// Observe only media state. No recording, capture, direct stream request, or forced play().
function observeMedia() {
  const seen = new Set();
  const ids = new WeakMap();
  let nextId = 0;
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    seen.add(this);
    return originalPlay.apply(this, args);
  };
  window.__mswMediaSnapshot = () => {
    document.querySelectorAll('audio,video').forEach(el => seen.add(el));
    return [...seen].map(el => {
      if (!ids.has(el)) ids.set(el, ++nextId);
      const src = el.currentSrc || el.src || '';
      return {
        key: ids.get(el), tag: el.tagName, elementId: el.id,
        time: el.currentTime, paused: el.paused, ended: el.ended,
        ready: el.readyState, error: el.error?.code || null,
        stationStream: /(?:radioking\.(?:io|com)\/.*(?:muggelseewelle|821596|890601))/i.test(src),
        likelyAd: /(?:doubleclick|adswizz|adserver|adservice|vast|preroll)/i.test(src),
      };
    });
  };
}

async function dismissOverlays(context) {
  const names = [/^(?:Reject All|Alle ablehnen|Alles ablehnen|Ablehnen|Nur notwendige Cookies)$/i, /^Nein Danke$/i, /^Zustimmen & Schließen$/i];
  for (const page of context.pages()) {
    for (const frame of page.frames()) {
      for (const name of names) {
        const button = frame.getByRole('button', { name }).first();
        if (await button.isVisible().catch(() => false)) {
          await button.click({ timeout: 1200 }).catch(() => {});
        }
      }
      const close = frame.locator('button[class*="close-button-module__button"]').first();
      if (await close.isVisible().catch(() => false)) await close.click({ timeout: 1200 }).catch(() => {});
    }
  }
}

async function blockedReason(page) {
  const text = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '');
  if (/Sicherheitsüberprüfung|verify you are human|checking your browser|Just a moment|Access denied|unusual traffic/i.test(text)) return 'Sicherheitsprüfung/Zugriffsschutz verhindert den Test.';
  if (/not currently available|zurzeit nicht verfügbar|in deiner Region nicht verfügbar/i.test(text)) return 'Plattform meldet den Sender als nicht verfügbar.';
  return null;
}

async function clickPlay(page, site) {
  if (site.native) {
    const media = page.locator('video,audio').first();
    if (await media.isVisible().catch(() => false)) {
      if (await media.evaluate(el => !el.paused && !el.ended)) return 'autostart';
      // Native browser media document: Space activates its playback control.
      await media.press('Space', { timeout: 2000 });
      return true;
    }
  }
  for (const selector of site.selectors || []) {
    for (const frame of page.frames()) {
      const controls = frame.locator(selector);
      for (let i = 0; i < Math.min(await controls.count(), 6); i++) {
        const control = controls.nth(i);
        if (!await control.isVisible().catch(() => false)) continue;
        try { await control.click({ timeout: 1800 }); return true; } catch {}
      }
    }
  }
  return false;
}

async function sample(context) {
  const states = [];
  for (const [pageIndex, page] of context.pages().entries()) {
    for (const [frameIndex, frame] of page.frames().entries()) {
      if (frame !== page.mainFrame() && !/(?:tunein|radioking|phonostar|welove|player)/i.test(frame.url())) continue;
      const read = frame.evaluate(() => window.__mswMediaSnapshot?.() || [...document.querySelectorAll('audio,video')].map((el, index) => ({
        key: `native-${index}`, tag: el.tagName, elementId: el.id,
        time: el.currentTime, paused: el.paused, ended: el.ended, ready: el.readyState,
        error: el.error?.code || null,
        stationStream: /radioking\.(?:io|com)\/.*(?:muggelseewelle|821596|890601)/i.test(el.currentSrc || el.src || location.href),
        likelyAd: false,
      }))).catch(() => []);
      let timer;
      const media = await Promise.race([read, new Promise(resolve => { timer = setTimeout(() => resolve([]), 1200); })]);
      clearTimeout(timer);
      states.push(...media.map(state => ({ ...state, key: `${pageIndex}:${frameIndex}:${state.key}` })));
    }
  }
  return states;
}

async function testSite(browser, site) {
  const started = Date.now();
  const context = await browser.newContext({ locale: 'de-DE', viewport: { width: 1366, height: 900 } });
  await context.addInitScript(observeMedia);
  const page = await context.newPage();
  const hardLimit = setTimeout(() => { void context.close().catch(() => {}); }, 65000);
  let clicked = false;
  let httpStatus = null;
  let outcome;
  try {
    const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    httpStatus = response?.status() || null;
    await page.waitForTimeout(2500);
    const denied = await blockedReason(page);
    if (denied) {
      outcome = { status: /Zugriffsschutz/.test(denied) ? 'BLOCKIERT' : 'FEHLER', detail: denied };
    } else {
      const deadline = Date.now() + 12000;
      while (!clicked && Date.now() < deadline) {
        await dismissOverlays(context);
        clicked = await clickPlay(page, site);
        if (!clicked) await page.waitForTimeout(800);
      }
      if (!clicked) outcome = httpStatus >= 400
        ? { status: 'FEHLER', detail: `HTTP ${httpStatus}; kein bedienbarer Play-Button gefunden.` }
        : { status: 'UNGEPRUEFT', detail: 'Kein bedienbarer Play-Button gefunden; Player/Seitenlayout prüfen.' };
      else {
        const handledPopups = new WeakSet();
        const previous = new Map();
        const progress = new Map();
        let sawOtherProgress = false;
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline && !outcome) {
          await page.waitForTimeout(1000);
          const states = await sample(context);
          for (const state of states) {
            const prior = previous.get(state.key);
            previous.set(state.key, state);
            // Ignore advertising video and unrelated weather/radio-greeting players.
            const relevant = site.mediaId ? state.elementId === site.mediaId : state.stationStream;
            const playing = !state.paused && !state.ended && !state.error && state.ready >= 2;
            if (prior && playing && state.time > prior.time + 0.25) {
              if (!relevant || state.likelyAd) { sawOtherProgress = true; continue; }
              const count = (progress.get(state.key) || 0) + 1;
              progress.set(state.key, count);
              if (count >= 2) outcome = { status: 'GESTARTET', detail: `${clicked === 'autostart' ? 'Automatischer Wiedergabestart' : 'Play betätigt'}; Sender-Mediaplayer läuft und Abspielzeit steigt über mehrere Messungen.`, progressSeconds: Number((state.time - prior.time).toFixed(2)) };
            } else progress.set(state.key, 0);
          }
          if (outcome) break;
          // phonostar may open its own player page/window after the initial link.
          for (const popup of context.pages().filter(p => p !== page)) {
            if (handledPopups.has(popup)) continue;
            handledPopups.add(popup);
            await dismissOverlays(context);
            await clickPlay(popup, { selectors: ['button[aria-label*="Play"]', 'button[aria-label*="abspielen"]', '.jp-play', 'button.play', 'a.play'] }).catch(() => {});
          }
        }
        if (!outcome) {
          const states = await sample(context);
          const errors = states.filter(s => s.error && (s.stationStream || (site.mediaId && s.elementId === site.mediaId)));
          const senderFound = states.some(s => s.stationStream || (site.mediaId && s.elementId === site.mediaId));
          outcome = errors.length
            ? { status: 'FEHLER', detail: `Play betätigt; Medienfehler ${errors[0].error}.` }
            : senderFound
              ? { status: 'FEHLER', detail: 'Play betätigt; Senderplayer gefunden, aber kein stabiler Wiedergabestart innerhalb von 20 Sekunden.' }
              : { status: 'UNGEPRUEFT', detail: sawOtherProgress ? 'Medienwiedergabe erkannt, aber Senderstream nicht eindeutig zugeordnet (möglicherweise Werbung).' : 'Play betätigt, aber Senderplayer/Wiedergabefortschritt nicht eindeutig erkennbar.' };
        }
      }
    }
  } catch (error) {
    outcome = { status: 'UNGEPRUEFT', detail: error.name === 'TimeoutError' ? 'Zeitlimit beim Öffnen oder Bedienen der Seite erreicht.' : 'Browser-/Netzwerkfehler beim Test.' };
  } finally {
    clearTimeout(hardLimit);
    if (process.env.DEBUG_MONITOR && !process.env.GITHUB_ACTIONS && outcome?.status !== 'GESTARTET') {
      console.log(JSON.stringify({ platform: site.name, media: await sample(context), pages: context.pages().map(p => p.url().split('?')[0]) }));
    }
    await context.close();
  }
  return { platform: site.name, url: site.url, ...outcome, playClicked: clicked === true, startMethod: clicked === 'autostart' ? 'AUTOSTART' : clicked ? 'PLAY_BUTTON' : 'KEINE', httpStatus, durationSeconds: Math.round((Date.now() - started) / 1000) };
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const results = [];
  try {
    // Two isolated pages at a time keep resource use low and prevent cross-player matches.
    for (let index = 0; index < sites.length; index += 2) {
      results.push(...await Promise.all(sites.slice(index, index + 2).map(site => testSite(browser, site))));
      if (!process.env.GITHUB_ACTIONS) console.log(`Geprüft: ${results.map(r => `${r.platform}: ${r.status}`).join('; ')}`);
    }
  } finally { await browser.close(); }
  const report = {
    checkedAt: new Date().toISOString(), testType: 'player-start-no-recording',
    runUrl: process.env.GITHUB_ACTIONS ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    summary: Object.fromEntries(['GESTARTET', 'FEHLER', 'BLOCKIERT', 'UNGEPRUEFT'].map(status => [status, results.filter(r => r.status === status).length])), results,
  };
  await fs.writeFile('result.json', JSON.stringify(report, null, 2));
  if (process.env.MAKE_WEBHOOK_URL) {
    const endpoint = new URL(process.env.MAKE_WEBHOOK_URL);
    if (endpoint.protocol !== 'https:' || !/^hook\.[a-z0-9-]+\.make\.com$/.test(endpoint.hostname)) throw new Error('Ungültige Make-Empfangsadresse.');
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report), signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) throw new Error(`Make hat die Ergebnisse abgelehnt (HTTP ${response.status}).`);
    console.log('Ergebnisbericht an Make übermittelt.');
  } else if (process.env.GITHUB_ACTIONS) {
    throw new Error('MAKE_WEBHOOK_URL fehlt. Ergebnisbericht wurde nicht an Make übermittelt.');
  } else console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message.replace(/https?:\/\/\S+/g, '[URL]')); process.exitCode = 1; });
module.exports = { sites, observeMedia, testSite };
