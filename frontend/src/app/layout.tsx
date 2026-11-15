import type { Metadata } from "next";
import { LocaleProvider } from "@/components/locale-provider";
import { translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "metadataTitle"),
    description: translate(locale, "metadataDescription"),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html lang={locale} className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var theme="system";try{theme=localStorage.getItem("adrobot-theme")||"system"}catch{}document.documentElement.classList.toggle("dark",theme==="dark"||(theme!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))})();`,
          }}
        />
      </head>
      <body className="min-h-full">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
