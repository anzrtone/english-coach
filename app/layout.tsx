import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Lingo — Free English Coach for Professionals',
  description:
    'Practice your workplace English for free with Lingo, your AI-powered English coach. Built for immigrant professionals in the Middle East.',
  keywords: [
    'English learning',
    'English coach',
    'workplace English',
    'Gulf region',
    'Middle East',
    'professional English',
    'ESL',
    'language learning',
  ],
  openGraph: {
    title: 'Lingo — Free English Coach for Professionals',
    description:
      'Practice your workplace English for free with an AI-powered English coach designed for immigrant professionals in the Middle East.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
