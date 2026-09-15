import React from 'react';
import { Card, Copy } from '../../components/ui';
// Only display provider fields that exist. Missing live values never become zero or "open".
export function CorridorRecords({
  items,
}: {
  items: Record<string, unknown>[];
}) {
  return (
    <>
      {items.map((item, index) => (
        <Card key={typeof item.id === 'string' ? item.id : index}>
          {[
            'name',
            'title',
            'type',
            'description',
            'status',
            'availability',
            'price',
            'currency',
            'provider',
            'source',
            'updatedAt',
            'lastUpdatedAt',
            'observedAt',
          ].map(key =>
            typeof item[key] === 'string' || typeof item[key] === 'number' ? (
              <Copy key={key}>
                {key}: {String(item[key])}
              </Copy>
            ) : null,
          )}
        </Card>
      ))}
    </>
  );
}
