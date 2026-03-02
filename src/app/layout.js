import "./globals.css";

export const metadata = {
  title: "Pete's Pandemonium",
  description: "2026 NCAA March Madness",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}