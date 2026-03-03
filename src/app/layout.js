import "./globals.css";

export const metadata = {
  title: "Pete's Pandemonium",
  description: "2026 NCAA March Madness",
};

// ✅ This is what prevents “mobile zoom / weird scaling”
export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}