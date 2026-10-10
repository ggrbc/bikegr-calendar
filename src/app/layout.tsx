import type { Metadata } from "next";
import { Chivo, Open_Sans } from "next/font/google";
import "./globals.css";

// Bike GR brand fonts (bikegr.org and the Tockify calendar): Chivo for headings, titles, date
// lines, and buttons; Open Sans for body text. Both are variable fonts, self-hosted at build time.
const chivo = Chivo({
  variable: "--next-font-chivo",
  subsets: ["latin"],
  display: "swap",
});

const openSans = Open_Sans({
  variable: "--next-font-open-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bike GR Calendar",
  description: "Rides, events, and advocacy meetings from the Greater Grand Rapids Bicycle Coalition",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${chivo.variable} ${openSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
