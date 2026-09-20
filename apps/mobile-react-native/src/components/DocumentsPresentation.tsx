import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DriverIcon, type DriverIconName } from './DriverIcon';
import { useDriverPalette } from './DriverUI';

export const documentCategories: {
  type: string;
  label: string;
  defaultLabel: string;
  icon: DriverIconName;
  day: string;
  night: string;
  symbol?: string;
}[] = [
  {
    type: 'CDL',
    label: 'CDL',
    defaultLabel: 'Commercial Driver License',
    icon: 'person',
    day: '#2457B8',
    night: '#8ABBFF',
  },
  {
    type: 'MEDICAL',
    label: 'Medical',
    defaultLabel: 'Medical card',
    icon: 'person',
    symbol: '+',
    day: '#B32648',
    night: '#FF9AAF',
  },
  {
    type: 'REGISTRATION',
    label: 'Registration',
    defaultLabel: 'Truck registration',
    icon: 'local_shipping_rounded',
    day: '#007A5B',
    night: '#68DEBA',
  },
  {
    type: 'INSURANCE',
    label: 'Insurance',
    defaultLabel: 'Insurance',
    icon: 'verified_user_rounded',
    day: '#00699C',
    night: '#7DD5FF',
  },
  {
    type: 'PERMIT',
    label: 'Permit',
    defaultLabel: 'Permit',
    icon: 'description',
    day: '#6C3AB5',
    night: '#CCA9FF',
  },
  {
    type: 'IFTA',
    label: 'IFTA',
    defaultLabel: 'IFTA',
    icon: 'local_gas_station_rounded',
    day: '#A54800',
    night: '#FFBA7A',
  },
  {
    type: 'BOL',
    label: 'BOL',
    defaultLabel: 'Bill of lading',
    icon: 'description',
    day: '#855139',
    night: '#E8BA9F',
  },
  {
    type: 'POD',
    label: 'POD',
    defaultLabel: 'Proof of delivery',
    icon: 'verified_user_rounded',
    symbol: '✓',
    day: '#007850',
    night: '#77DFB3',
  },
  {
    type: 'RATE_CONFIRMATION',
    label: 'Rate Confirmation',
    defaultLabel: 'Rate confirmation',
    icon: 'description',
    symbol: '$',
    day: '#886000',
    night: '#FFD277',
  },
  {
    type: 'GENERAL',
    label: 'General',
    defaultLabel: 'Document',
    icon: 'folder_open_rounded',
    day: '#475569',
    night: '#C0CDDC',
  },
];
export function documentCategory(type: string) {
  return (
    documentCategories.find(category => category.type === type) ??
    documentCategories[9]!
  );
}
export function DocumentIcon({ type }: { type: string }) {
  const p = useDriverPalette(),
    category = documentCategory(type);
  const color = p.dark ? category.night : category.day;
  return (
    <View style={[ds.iconTile, { backgroundColor: p.input }]}>
      {category.symbol ? (
        <Text accessible={false} style={[ds.symbol, { color }]}>
          {category.symbol}
        </Text>
      ) : (
        <DriverIcon name={category.icon} color={color} size={27} />
      )}
    </View>
  );
}
export function DocumentCategories({
  onSelect,
  disabled,
}: {
  onSelect: (type: string) => void;
  disabled: boolean;
}) {
  const p = useDriverPalette();
  return (
    <View style={ds.grid}>
      {documentCategories.map(category => (
        <Pressable
          key={category.type}
          accessibilityRole="button"
          accessibilityLabel={'Add ' + category.label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onSelect(category.type)}
          style={[
            ds.category,
            { backgroundColor: p.card, borderColor: p.border },
            disabled && ds.disabled,
          ]}
        >
          <DocumentIcon type={category.type} />
          <Text style={[ds.categoryLabel, { color: p.text }]}>
            {category.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Date-only values use UTC arithmetic, without converting stored days to local instants. */
export function documentDay(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const time = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === day
    ? time
    : undefined;
}
export function documentDateLabel(value: string | null | undefined) {
  const day = documentDay(value);
  return day === undefined
    ? 'Not recorded'
    : new Date(day).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}
export function documentExpiry(value: string | null, now = new Date()) {
  const day = documentDay(value);
  if (day === undefined)
    return { label: 'No expiration date', soon: false, expired: false };
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((day - today) / 86400000);
  return {
    label:
      days < 0
        ? 'Expired'
        : days === 0
        ? 'Expires today'
        : days <= 90
        ? `In ${days} days`
        : 'Date recorded',
    soon: days >= 0 && days <= 90,
    expired: days < 0,
    days,
  };
}
export function DocumentRow({
  document,
  onPress,
  disabled,
  now,
}: {
  document: {
    id: string;
    type: string;
    fileName: string;
    expiresOn: string | null;
    attachmentCount?: number;
    fileAvailable?: boolean;
  };
  onPress: () => void;
  disabled: boolean;
  now: Date;
}) {
  const p = useDriverPalette(),
    expiry = documentExpiry(document.expiresOn, now);
  const color = expiry.expired
    ? p.dark
      ? '#FFB4B4'
      : '#A52626'
    : expiry.soon
    ? p.dark
      ? '#FFD083'
      : '#855000'
    : p.muted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={'Edit document: ' + document.fileName}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        ds.documentRow,
        { borderColor: p.border },
        disabled && ds.disabled,
      ]}
    >
      <DocumentIcon type={document.type} />
      <View style={ds.flex}>
        <Text style={[ds.recordTitle, { color: p.text }]}>
          {document.fileName}
        </Text>
        <Text style={[ds.copy, { color: p.muted }]}>
          {documentCategory(document.type).label} ·{' '}
          {documentDay(document.expiresOn) !== undefined
            ? 'Expires ' + documentDateLabel(document.expiresOn)
            : 'Expiration not recorded'}
        </Text>
        <Text style={[ds.status, { color }]}>{expiry.label}</Text>
        <Text style={[ds.copy, { color: p.muted }]}>
          {document.fileAvailable
            ? (document.attachmentCount ?? '') + ' saved attachment(s)'
            : 'Document record · no saved attachment'}
        </Text>
      </View>
      <DriverIcon name="chevron_right_rounded" color={p.muted} />
    </Pressable>
  );
}

/** A selectable calendar, not a free-text date field. No device/network permission required. */
export function DocumentDateField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const p = useDriverPalette();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => new Date());
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const year = cursor.getFullYear(),
    month = cursor.getMonth();
  const chooseMonth = (y: number, m: number) =>
    setCursor(new Date(y, m, 1, 12));
  const selectedColor = p.dark ? '#FFAB80' : '#A63D0B';
  function control(title: string, action: () => void) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        disabled={disabled}
        onPress={action}
        style={ds.calendarControl}
      >
        <Text style={[ds.controlText, { color: selectedColor }]}>{title}</Text>
      </Pressable>
    );
  }
  const count = new Date(year, month + 1, 0).getDate(),
    offset = new Date(year, month, 1).getDay();
  return (
    <View style={ds.section}>
      <Text style={[ds.recordTitle, { color: p.text }]}>
        {label} <Text style={[ds.copy, { color: p.muted }]}>(optional)</Text>
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          const day = documentDay(value);
          const d = day === undefined ? new Date() : new Date(day);
          setCursor(
            day === undefined
              ? d
              : new Date(
                  d.getUTCFullYear(),
                  d.getUTCMonth(),
                  d.getUTCDate(),
                  12,
                ),
          );
          setMode('days');
          setOpen(!open);
        }}
        style={[
          ds.dateField,
          { backgroundColor: p.input, borderColor: p.border },
          disabled && ds.disabled,
        ]}
      >
        <Text style={[ds.copy, { color: p.text }]}>
          {value ? documentDateLabel(value) : 'Select date'}
        </Text>
        <DriverIcon name="chevron_right_rounded" color={p.muted} />
      </Pressable>
      {open && !disabled && (
        <View style={[ds.calendar, { borderColor: p.border }]}>
          <View style={ds.calendarHeader}>
            {control('Previous', () =>
              chooseMonth(
                mode === 'years'
                  ? year - 12
                  : mode === 'months'
                  ? year - 1
                  : year,
                mode === 'days' ? month - 1 : month,
              ),
            )}
            {control(
              mode === 'days'
                ? cursor.toLocaleDateString(undefined, {
                    month: 'long',
                    year: 'numeric',
                  })
                : String(year),
              () => setMode(mode === 'years' ? 'days' : 'years'),
            )}
            {control('Next', () =>
              chooseMonth(
                mode === 'years'
                  ? year + 12
                  : mode === 'months'
                  ? year + 1
                  : year,
                mode === 'days' ? month + 1 : month,
              ),
            )}
          </View>
          {mode === 'days' ? (
            <>
              <View style={ds.calendarGrid}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                  <View key={i} style={ds.day}>
                    <Text style={[ds.copy, { color: p.muted }]}>{day}</Text>
                  </View>
                ))}
              </View>
              <View style={ds.calendarGrid}>
                {Array.from({ length: offset + count }, (_, i) => {
                  const day = i - offset + 1;
                  if (day < 1) return <View key={i} style={ds.day} />;
                  const date =
                    String(year).padStart(4, '0') +
                    '-' +
                    String(month + 1).padStart(2, '0') +
                    '-' +
                    String(day).padStart(2, '0');
                  return (
                    <Pressable
                      key={i}
                      accessibilityRole="button"
                      accessibilityLabel={'Select ' + date}
                      accessibilityState={{ selected: date === value }}
                      onPress={() => {
                        onChange(date);
                        setOpen(false);
                      }}
                      style={[ds.day, date === value && ds.selectedDay]}
                    >
                      <Text
                        style={[
                          ds.dayText,
                          { color: p.text },
                          date === value && ds.selectedDayText,
                        ]}
                      >
                        {day}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : (
            <View style={ds.calendarGrid}>
              {Array.from({ length: 12 }, (_, i) =>
                mode === 'years' ? year - 5 + i : i,
              ).map(n => (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  accessibilityLabel={
                    mode === 'years'
                      ? 'Year ' + n
                      : new Date(year, n, 1).toLocaleDateString(undefined, {
                          month: 'long',
                        })
                  }
                  onPress={() => {
                    chooseMonth(
                      mode === 'years' ? n : year,
                      mode === 'months' ? n : month,
                    );
                    setMode(mode === 'years' ? 'months' : 'days');
                  }}
                  style={ds.month}
                >
                  <Text style={[ds.copy, { color: p.text }]}>
                    {mode === 'years'
                      ? n
                      : new Date(year, n, 1).toLocaleDateString(undefined, {
                          month: 'short',
                        })}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={ds.calendarHeader}>
            {control('Clear date', () => {
              onChange('');
              setOpen(false);
            })}
            {control('Cancel date selection', () => setOpen(false))}
          </View>
        </View>
      )}
    </View>
  );
}
export const ds = StyleSheet.create({
  page: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 32,
    gap: 20,
    flexGrow: 1,
  },
  section: { gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  category: {
    width: '48.5%',
    minHeight: 72,
    borderWidth: 1,
    borderRadius: 16,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryLabel: { fontSize: 15, fontWeight: '700', flex: 1 },
  iconTile: {
    width: 38,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbol: { fontSize: 29, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  recordTitle: { fontSize: 16, fontWeight: '700' },
  copy: { fontSize: 14, lineHeight: 21 },
  documentRow: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 78,
  },
  status: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  dateField: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calendar: { borderWidth: 1, borderRadius: 16, padding: 6, gap: 8 },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  calendarControl: { minHeight: 44, padding: 8, justifyContent: 'center' },
  controlText: { fontSize: 14, fontWeight: '700' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  day: {
    width: '14.285714%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  month: {
    width: '33.33333%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { fontSize: 16, fontWeight: '600' },
  selectedDay: { backgroundColor: '#FF6B2C' },
  selectedDayText: { color: '#172433' },
});
