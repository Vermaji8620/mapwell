import type { Metadata } from 'next';
import './globals.css';
import { ShellLayout } from '@/components/ShellLayout';

export const metadata: Metadata = {
  title: 'MapWell - Community Health Mapping & Needs Assessment',
  description: 'Geospatial health data visualization and community needs assessment platform for public health departments.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ShellLayout>{children}</ShellLayout>
      </body>
    </html>
  );
}
