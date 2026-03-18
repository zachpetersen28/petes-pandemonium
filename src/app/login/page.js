"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const POOL_PASSCODE = "Winner2026";

export default function LoginPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [adminPasscode, setAdminPasscode] = useState("");

  const [errorMsg, setErrorMsg] = useState("");
  const [shake, setShake] = useState(false);

  const shakeTimer = useRef(null);
const audioRef = useRef(null);
  useEffect(() => {
    return () => {
      if (shakeTimer.current) clearTimeout(shakeTimer.current);
    };
  }, []);
  const triggerShake = () => {
    setShake(true);
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShake(false), 520);
  };

  const canSubmit = useMemo(() => {
    return Boolean(String(name).trim() && String(passcode).trim());
  }, [name, passcode]);

const onSubmit = async (e) => {
  e.preventDefault();
  setErrorMsg("");

  const n = String(name || "").trim();
  const p = String(passcode || "").trim();
  const a = String(adminPasscode || "").trim();

  if (!n || !p) {
    setErrorMsg("Enter your name and passcode.");
    triggerShake();
    return;
  }

  const insults = [
    "Really!? It's not that hard. Try again.",
    "Spelling is hard, especially for your kind.",
    "I'd give up if I were you. If you can't sign in, you sure as hell can't win.",
  ];

  if (p !== POOL_PASSCODE) {
    setErrorMsg(insults[Math.floor(Math.random() * insults.length)]);
    triggerShake();
    return;
  }

  let isAdmin = false;
  if (a) {
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: a }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) isAdmin = true;
    } catch {
      isAdmin = false;
    }
  }

  localStorage.setItem(
    "mm_user",
    JSON.stringify({
      name: n,
      role: isAdmin ? "admin" : "user",
      isAdmin,
    })
  );

  if (audioRef.current) {
    try {
      audioRef.current.currentTime = 0;
      audioRef.current.volume = 0.5;
      await audioRef.current.play();
    } catch {}
  }

  router.replace("/");
};
  return (
    <div style={styles.page}>
  <audio ref={audioRef} src="/login-sound.mp3" preload="auto" />
  <div style={styles.shell}>
        <div style={{ ...styles.card, ...(shake ? styles.cardShake : {}) }}>
          {/* HERO SECTION */}
          <div style={styles.heroWrap}>
            {/* Blurred background fill */}
            <div style={styles.heroBg} />

            {/* Crisp foreground logo */}
            <img
              src="/logo-hero.png"
              alt="Pete’s Pandemonium"
              style={styles.heroImg}
            />
          </div>

          {/* Gold divider */}
          <div style={styles.divider} />

          {/* FORM PANEL */}
          <div style={styles.panel}>
            <form onSubmit={onSubmit}>
              <label style={styles.label}>Name</label>
              <input
                style={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />

              <label style={{ ...styles.label, marginTop: 10 }}>
                Pool passcode
              </label>
              <input
                style={styles.input}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter passcode"
                autoComplete="off"
                type="password"
              />

              <label style={{ ...styles.label, marginTop: 10 }}>
                Admin passcode (optional)
              </label>
              <input
                style={styles.input}
                value={adminPasscode}
                onChange={(e) => setAdminPasscode(e.target.value)}
                placeholder="Admin only"
                autoComplete="off"
                type="password"
              />

              {errorMsg ? <div style={styles.error}>{errorMsg}</div> : null}

              <button
                type="submit"
                disabled={!canSubmit}
                style={{ ...styles.btn, ...(canSubmit ? {} : styles.btnDisabled) }}
              >
                Enter
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(700px 400px at 50% 0%, rgba(34,197,94,0.12), transparent 60%), #c2cfae",
    display: "grid",
    placeItems: "center",
   padding: "4px 16px",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
  },

  shell: { width: "100%", maxWidth: 460 },

  card: {
    borderRadius: 24,
    overflow: "hidden",
    background: "#050607",
    border: "1px solid rgba(255,255,255,0.06)",
    boxShadow: "0 28px 80px rgba(0,0,0,0.55)",
  },

  /* HERO */

heroWrap: {
  position: "relative",
height: "clamp(220px, 36vw, 300px)",
  overflow: "hidden",
  display: "grid",
  placeItems: "center",
  padding: "16px 18px 22px", // extra bottom breathing room for the banner
  background: "#050607",
},

heroBg: {
  position: "absolute",
  inset: 0,
  backgroundImage: "url(/logo-hero.png)",
  backgroundSize: "cover",
  backgroundPosition: "center",
  filter: "blur(22px) brightness(0.50)",
  transform: "scale(1.18)",
  opacity: 0.9,
},

heroImg: {
  position: "relative",
  zIndex: 1,
  height: "90%",      // keep your scaling
  width: "90%",
  objectFit: "contain",
  objectPosition: "center",
  transform: "translateY(-35px)", // 👈 move up slightly
  filter: "drop-shadow(0 12px 20px rgba(0,0,0,0.6))",
},

  divider: {
    height: 2,
    background:
      "linear-gradient(90deg, rgba(0,0,0,0) 0%, #FBBF24 50%, rgba(0,0,0,0) 100%)",
  },

  panel: {
    padding: 14,
    background: "#050607",
  },

  label: {
    display: "block",
    marginTop: 10,
    fontSize: 12,
    fontWeight: 900,
    color: "rgba(248,250,252,0.85)",
  },

  input: {
    width: "100%",
    marginTop: 6,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    outline: "none",
    fontSize: 14,
    boxSizing: "border-box",
    background: "rgba(255,255,255,0.05)",
    color: "#f8fafc",
  },

  btn: {
    width: "100%",
    marginTop: 16,
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid rgba(34,197,94,0.45)",
    background: "linear-gradient(180deg, #16a34a 0%, #14532d 100%)",
    color: "white",
    fontWeight: 950,
    cursor: "pointer",
  },

  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },

  error: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(239,68,68,0.35)",
    background: "rgba(239,68,68,0.12)",
    fontWeight: 900,
    fontSize: 12,
    color: "#fecaca",
  },

  cardShake: { animation: "pp_shake 520ms ease" },
};