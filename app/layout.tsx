import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Lingo — Free English Coach for Caregivers & Hospitality Workers',
  description:
    'Practice practical daily English for free with Lingo, your AI English coach. Built for immigrant caregivers, babysitters, elder aides, and hospitality workers.',
  keywords: [
    'English learning',
    'English coach',
    'caregiver English',
    'babysitter English',
    'hospitality English',
    'immigrant workers',
    'ESL',
    'language learning',
  ],
  openGraph: {
    title: 'Lingo — Free English Coach for Caregivers',
    description:
      'Practice practical daily English for free with an AI-powered coach designed for immigrant caregivers, babysitters, and hospitality workers.',
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
