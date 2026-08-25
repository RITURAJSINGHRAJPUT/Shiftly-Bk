import { useState, useEffect } from 'react';
import { Download, Share, X } from 'lucide-react';

const DISMISS_KEY = 'shiftly_install_dismissed';

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === 'true') return;
    } catch {
      // Storage unavailable — fall through and show the banner anyway.
    }

    // iOS never fires beforeinstallprompt, so the only thing to offer there is
    // the Share-sheet instructions, shown right away rather than waiting for
    // an event that will never come.
    if (isIos()) {
      setVisible(true);
      return;
    }

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Per-session dismissal still works via the visible state above.
    }
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
  };

  if (!visible) return null;

  return (
    <div className="install-banner">
      {deferredPrompt ? (
        <>
          <Download size={16} />
          <span>Install Bookends Shiftly for quicker access</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={install}>
            Install
          </button>
        </>
      ) : (
        <>
          <Share size={16} />
          <span>Install this app: tap Share, then "Add to Home Screen"</span>
        </>
      )}
      <button type="button" className="btn btn-ghost btn-icon" onClick={dismiss} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
