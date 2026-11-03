'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Location } from '@/types/database';
import { inputClass } from '@/components/ui';

export default function LocationFilter({
  locations,
  location,
  query,
}: {
  locations: Location[];
  location: string;
  query: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query);

  function push(next: { location?: string; q?: string }) {
    const params = new URLSearchParams();
    const nextLocation = next.location ?? location;
    const nextQuery = next.q ?? search;
    if (nextLocation) params.set('location', nextLocation);
    if (nextQuery) params.set('q', nextQuery);
    router.push(params.size ? `/products?${params}` : '/products');
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        push({});
      }}
    >
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search SKU, name or brand"
        aria-label="Search products"
        className={`${inputClass} w-56`}
      />
      <select
        value={location}
        aria-label="Filter by location"
        onChange={(event) => push({ location: event.target.value })}
        className={`${inputClass} w-48`}
      >
        <option value="">All locations</option>
        {locations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.code} — {item.name}
          </option>
        ))}
      </select>
    </form>
  );
}
