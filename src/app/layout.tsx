import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Bug Detector',
  description: 'AI-Powered GitHub Code Reviewer & Bug Detector',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
