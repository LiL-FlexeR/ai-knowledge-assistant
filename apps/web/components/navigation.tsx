'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export function Navigation() {
  const path = usePathname();
  return (
    <nav aria-label="Main navigation" className="flex gap-2">
      {[
        ['/documents', 'Documents'],
        ['/ask', 'Ask AI'],
      ].map(([href, label]) => (
        <Link
          key={href}
          href={href!}
          aria-current={path === href ? 'page' : undefined}
          className="nav-link"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
