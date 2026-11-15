import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Adrobot | Campaign management",
  description: "Create and manage Keitaro advertising campaigns with Adrobot.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var theme="system";try{theme=localStorage.getItem("adrobot-theme")||"system"}catch{}document.documentElement.classList.toggle("dark",theme==="dark"||(theme!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))})();`,
          }}
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
