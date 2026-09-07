import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Серверная инфраструктура — университетский курс',
  description:
    'Самостоятельный университетский курс по серверной инфраструктуре с лабораторными работами и автоматической проверкой знаний.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
