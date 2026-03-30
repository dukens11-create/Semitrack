import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../../core/widgets.dart';
import '../../models/trip_stop.dart';
import '../../models/stop_appointment.dart';

/// Multi-stop trip planner with shipper/receiver appointment management.
///
/// Drivers and dispatchers can:
///  - Add, reorder, and remove stops (pickup / delivery / waypoint)
///  - Attach appointment details to each stop (time window, facility,
///    reference, notes such as dock #, gate code, phone)
///  - See a live ETA estimate per stop and a lateness warning when the
///    estimated arrival exceeds the appointment window
class TripPlannerScreen extends StatefulWidget {
  const TripPlannerScreen({super.key});

  @override
  State<TripPlannerScreen> createState() => _TripPlannerScreenState();
}

class _TripPlannerScreenState extends State<TripPlannerScreen> {
  // ── Demo stops pre-populated so the screen is never blank ─────────────────
  final List<TripStop> _stops = [
    TripStop(
      id: '1',
      name: 'Portland, OR (Origin)',
      position: const LatLng(45.5231, -122.6765),
      type: StopType.pickup,
    ),
    TripStop(
      id: '2',
      name: 'Boise, ID',
      position: const LatLng(43.6150, -116.2023),
      type: StopType.waypoint,
    ),
    TripStop(
      id: '3',
      name: 'Reno, NV (Destination)',
      position: const LatLng(39.5296, -119.8138),
      type: StopType.delivery,
    ),
  ];

  // ── Appointments keyed by stop id ─────────────────────────────────────────
  final Map<String, StopAppointment> _appointments = {};

  @override
  void initState() {
    super.initState();
    // Seed demo appointments.
    _appointments['1'] = StopAppointment(
      stopId: '1',
      type: 'pickup',
      appointmentTime: DateTime.now().add(const Duration(hours: 1)),
      earliestArrival: DateTime.now().add(const Duration(minutes: 45)),
      latestArrival: DateTime.now().add(const Duration(hours: 2)),
      facilityName: 'Portland Freight Hub',
      referenceNumber: 'BOL-20240101',
      note: 'Dock 4 - call ahead: 503-555-0120',
    );
    _appointments['3'] = StopAppointment(
      stopId: '3',
      type: 'delivery',
      appointmentTime: DateTime.now().add(const Duration(hours: 13)),
      earliestArrival:
          DateTime.now().add(const Duration(hours: 12, minutes: 30)),
      latestArrival: DateTime.now().add(const Duration(hours: 14)),
      facilityName: 'Reno Distribution Center',
      referenceNumber: 'PO-88421',
      note: 'Gate B - check in at security office',
    );
  }

  // ── Simple ETA estimation: 60 mph average ─────────────────────────────────
  static const double _avgSpeedMph = 60.0;

  /// Great-circle distance in miles between two [LatLng] points.
  static double _distanceMiles(LatLng a, LatLng b) {
    const earthRadiusMiles = 3958.8;
    final dLat = _toRad(b.latitude - a.latitude);
    final dLng = _toRad(b.longitude - a.longitude);
    final sinDLat = math.sin(dLat / 2);
    final sinDLng = math.sin(dLng / 2);
    final x = sinDLat * sinDLat +
        math.cos(_toRad(a.latitude)) *
            math.cos(_toRad(b.latitude)) *
            sinDLng *
            sinDLng;
    final c = 2 * math.asin(math.sqrt(x));
    return earthRadiusMiles * c;
  }

  static double _toRad(double deg) => deg * math.pi / 180.0;

  /// Estimates ETA for stop at [index] from the trip start (now).
  DateTime _estimatedEta(int index) {
    if (index == 0) return DateTime.now();
    double totalMiles = 0;
    for (int i = 1; i <= index; i++) {
      totalMiles +=
          _distanceMiles(_stops[i - 1].position, _stops[i].position);
    }
    final minutes = (totalMiles / _avgSpeedMph * 60).round();
    return DateTime.now().add(Duration(minutes: minutes));
  }

  // ── Appointment status helpers ────────────────────────────────────────────

  Color _statusColor(int index) {
    final appt = _appointments[_stops[index].id];
    if (appt == null) return Colors.grey.shade300;
    final eta = _estimatedEta(index);
    if (appt.isLate(eta)) return Colors.red;
    if (appt.isAtRisk(eta)) return Colors.orange;
    return Colors.green;
  }

  String _statusLabel(int index) {
    final appt = _appointments[_stops[index].id];
    if (appt == null) return 'No Appt';
    final eta = _estimatedEta(index);
    if (appt.isLate(eta)) return 'LATE';
    if (appt.isAtRisk(eta)) return 'At Risk';
    return 'On Time';
  }

  // ── Add stop dialog ───────────────────────────────────────────────────────

  void _showAddStopDialog() {
    final nameCtrl = TextEditingController();
    StopType selectedType = StopType.waypoint;

    showDialog<void>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDlgState) {
            return AlertDialog(
              title: const Text('Add Stop'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(
                        labelText: 'Location / address'),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<StopType>(
                    value: selectedType,
                    decoration:
                        const InputDecoration(labelText: 'Stop type'),
                    items: StopType.values
                        .map((t) => DropdownMenuItem(
                              value: t,
                              child: Text(t.label),
                            ))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) setDlgState(() => selectedType = v);
                    },
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Cancel'),
                ),
                ElevatedButton(
                  onPressed: () {
                    final name = nameCtrl.text.trim();
                    if (name.isEmpty) return;
                    setState(() {
                      _stops.add(TripStop(
                        id: DateTime.now()
                            .millisecondsSinceEpoch
                            .toString(),
                        name: name,
                        position: _stops.isNotEmpty
                            ? LatLng(
                                _stops.last.position.latitude + 0.5,
                                _stops.last.position.longitude + 0.5,
                              )
                            : const LatLng(45.0, -120.0),
                        type: selectedType,
                      ));
                    });
                    Navigator.pop(ctx);
                  },
                  child: const Text('Add'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  // ── Appointment editor sheet ──────────────────────────────────────────────

  void _showAppointmentSheet(TripStop stop) {
    final appt = _appointments[stop.id];
    final facilityCtrl =
        TextEditingController(text: appt?.facilityName ?? '');
    final refCtrl =
        TextEditingController(text: appt?.referenceNumber ?? '');
    final noteCtrl = TextEditingController(text: appt?.note ?? '');
    String apptType = appt?.type ?? stop.type.name;
    DateTime? apptTime = appt?.appointmentTime;
    DateTime? earliest = appt?.earliestArrival;
    DateTime? latest = appt?.latestArrival;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            Widget timeTile(
              String label,
              DateTime? value,
              void Function(DateTime) onPicked,
            ) {
              return ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(label,
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(
                  value != null ? _formatDateTime(value) : 'Not set',
                  style: TextStyle(
                    color: value != null ? Colors.black87 : Colors.grey,
                  ),
                ),
                trailing: const Icon(Icons.access_time),
                onTap: () async {
                  final date = await showDatePicker(
                    context: ctx,
                    initialDate: value ?? DateTime.now(),
                    firstDate: DateTime.now()
                        .subtract(const Duration(days: 1)),
                    lastDate:
                        DateTime.now().add(const Duration(days: 365)),
                  );
                  if (date == null || !ctx.mounted) return;
                  final time = await showTimePicker(
                    context: ctx,
                    initialTime: value != null
                        ? TimeOfDay.fromDateTime(value)
                        : TimeOfDay.now(),
                  );
                  if (time == null) return;
                  onPicked(DateTime(date.year, date.month, date.day,
                      time.hour, time.minute));
                },
              );
            }

            return Padding(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 20,
                bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
              ),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Header
                    Row(
                      children: [
                        const Icon(Icons.calendar_month, size: 28),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment:
                                CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Appointment',
                                style: TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.bold),
                              ),
                              Text(
                                stop.name,
                                style: const TextStyle(
                                    fontSize: 13, color: Colors.grey),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    const Divider(),

                    // Type
                    DropdownButtonFormField<String>(
                      value: apptType,
                      decoration:
                          const InputDecoration(labelText: 'Type'),
                      items: const [
                        DropdownMenuItem(
                            value: 'pickup', child: Text('Pickup')),
                        DropdownMenuItem(
                            value: 'delivery',
                            child: Text('Delivery')),
                        DropdownMenuItem(
                            value: 'waypoint',
                            child: Text('Waypoint')),
                      ],
                      onChanged: (v) {
                        if (v != null) {
                          setSheetState(() => apptType = v);
                        }
                      },
                    ),
                    const SizedBox(height: 8),

                    // Facility
                    TextField(
                      controller: facilityCtrl,
                      decoration: const InputDecoration(
                          labelText: 'Facility name',
                          prefixIcon: Icon(Icons.business)),
                    ),
                    const SizedBox(height: 8),

                    // Reference
                    TextField(
                      controller: refCtrl,
                      decoration: const InputDecoration(
                          labelText: 'Reference / BOL / PO #',
                          prefixIcon: Icon(Icons.tag)),
                    ),
                    const SizedBox(height: 8),

                    // Notes
                    TextField(
                      controller: noteCtrl,
                      maxLines: 2,
                      decoration: const InputDecoration(
                        labelText:
                            'Notes (dock #, phone, gate code)',
                        prefixIcon: Icon(Icons.notes),
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Divider(),

                    // Time window pickers
                    timeTile('Appointment time', apptTime, (v) {
                      setSheetState(() => apptTime = v);
                    }),
                    timeTile('Earliest arrival', earliest, (v) {
                      setSheetState(() => earliest = v);
                    }),
                    timeTile('Latest arrival (cutoff)', latest, (v) {
                      setSheetState(() => latest = v);
                    }),
                    const SizedBox(height: 16),

                    // Save / clear
                    Row(
                      children: [
                        if (_appointments.containsKey(stop.id))
                          Expanded(
                            child: OutlinedButton.icon(
                              icon: const Icon(Icons.delete_outline,
                                  color: Colors.red),
                              label: const Text('Clear',
                                  style:
                                      TextStyle(color: Colors.red)),
                              onPressed: () {
                                setState(() => _appointments
                                    .remove(stop.id));
                                Navigator.pop(ctx);
                              },
                            ),
                          ),
                        if (_appointments.containsKey(stop.id))
                          const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton.icon(
                            icon: const Icon(Icons.save),
                            label: const Text('Save'),
                            onPressed: () {
                              setState(() {
                                _appointments[stop.id] =
                                    StopAppointment(
                                  stopId: stop.id,
                                  type: apptType,
                                  appointmentTime: apptTime,
                                  earliestArrival: earliest,
                                  latestArrival: latest,
                                  facilityName:
                                      facilityCtrl.text
                                              .trim()
                                              .isEmpty
                                          ? null
                                          : facilityCtrl.text.trim(),
                                  referenceNumber:
                                      refCtrl.text.trim().isEmpty
                                          ? null
                                          : refCtrl.text.trim(),
                                  note:
                                      noteCtrl.text.trim().isEmpty
                                          ? null
                                          : noteCtrl.text.trim(),
                                );
                              });
                              Navigator.pop(ctx);
                            },
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  String _formatDateTime(DateTime dt) {
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    return '${dt.month}/${dt.day}  $h:$m';
  }

  String _formatEtaOffset(int index) {
    if (index == 0) return 'Now';
    final eta = _estimatedEta(index);
    final diff = eta.difference(DateTime.now());
    final h = diff.inHours;
    final m = diff.inMinutes % 60;
    if (h > 0) return '+${h}h ${m}m';
    return '+${m}m';
  }

  double _totalDistanceMiles() {
    double total = 0;
    for (int i = 1; i < _stops.length; i++) {
      total += _distanceMiles(
          _stops[i - 1].position, _stops[i].position);
    }
    return total;
  }

  String _totalEtaText() {
    final minutes =
        (_totalDistanceMiles() / _avgSpeedMph * 60).round();
    final h = minutes ~/ 60;
    final m = minutes % 60;
    if (h > 0) return '${h}h ${m}m';
    return '${m}m';
  }

  Color _stopTypeColor(StopType type) {
    switch (type) {
      case StopType.pickup:
        return Colors.blue.shade700;
      case StopType.delivery:
        return Colors.green.shade700;
      case StopType.waypoint:
        return Colors.grey.shade600;
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final hasLate = List.generate(_stops.length, (i) => i)
        .any((i) => _statusLabel(i) == 'LATE');
    final hasAtRisk = !hasLate &&
        List.generate(_stops.length, (i) => i)
            .any((i) => _statusLabel(i) == 'At Risk');

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Appointment warning banner
          if (hasLate)
            _AppointmentWarningBanner(
              color: Colors.red.shade700,
              icon: Icons.alarm_off,
              message:
                  'One or more stops will miss their appointment window!',
            )
          else if (hasAtRisk)
            _AppointmentWarningBanner(
              color: Colors.orange.shade700,
              icon: Icons.alarm,
              message:
                  'One or more stops are at risk of a late arrival.',
            ),

          // Trip summary card
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Trip Summary',
                  style: TextStyle(
                      fontWeight: FontWeight.bold, fontSize: 18),
                ),
                const SizedBox(height: 8),
                LabelValue(
                    label: 'Stops', value: '${_stops.length}'),
                LabelValue(
                  label: 'Appointments set',
                  value:
                      '${_appointments.length} / ${_stops.length}',
                ),
                LabelValue(
                  label: 'Est. total distance',
                  value: _stops.length < 2
                      ? '-'
                      : '${_totalDistanceMiles().toStringAsFixed(0)} mi',
                ),
                LabelValue(
                  label: 'Est. drive time',
                  value:
                      _stops.length < 2 ? '-' : _totalEtaText(),
                ),
              ],
            ),
          ),

          // Stop list header
          const Padding(
            padding: EdgeInsets.fromLTRB(4, 8, 4, 4),
            child: Text(
              'Stops  (hold & drag to reorder)',
              style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  color: Colors.black54),
            ),
          ),

          // Reorderable stop list
          ReorderableListView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _stops.length,
            onReorder: (oldIndex, newIndex) {
              setState(() {
                if (newIndex > oldIndex) newIndex--;
                final item = _stops.removeAt(oldIndex);
                _stops.insert(newIndex, item);
              });
            },
            itemBuilder: (ctx, i) {
              final stop = _stops[i];
              final appt = _appointments[stop.id];
              final statusColor = _statusColor(i);
              final statusLabel = _statusLabel(i);

              return Card(
                key: ValueKey(stop.id),
                margin: const EdgeInsets.symmetric(vertical: 4),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: _stopTypeColor(stop.type),
                    child: Text(
                      '${i + 1}',
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold),
                    ),
                  ),
                  title: Row(
                    children: [
                      Expanded(
                        child: Text(
                          stop.name,
                          style: const TextStyle(
                              fontWeight: FontWeight.w600),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: statusColor,
                          borderRadius:
                              BorderRadius.circular(12),
                        ),
                        child: Text(
                          statusLabel,
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${stop.type.label}  .  ETA ${_formatEtaOffset(i)}',
                        style: const TextStyle(fontSize: 12),
                      ),
                      if (appt != null) ...[
                        if (appt.facilityName != null)
                          Text(
                            appt.facilityName!,
                            style:
                                const TextStyle(fontSize: 12),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        if (appt.latestArrival != null)
                          Text(
                            'Window: '
                            '${appt.earliestArrival != null ? _formatDateTime(appt.earliestArrival!) : "-"}'
                            '  ->  '
                            '${_formatDateTime(appt.latestArrival!)}',
                            style: TextStyle(
                              fontSize: 12,
                              color: statusColor == Colors.red
                                  ? Colors.red
                                  : Colors.black87,
                            ),
                          ),
                        if (appt.referenceNumber != null)
                          Text(
                            'Ref: ${appt.referenceNumber}',
                            style: const TextStyle(
                                fontSize: 11,
                                color: Colors.grey),
                          ),
                        if (appt.note != null &&
                            appt.note!.isNotEmpty)
                          Text(
                            'Note: ${appt.note}',
                            style: const TextStyle(
                                fontSize: 11,
                                color: Colors.grey),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                      ] else
                        const Text(
                          'Tap calendar icon to add appointment',
                          style: TextStyle(
                              fontSize: 12,
                              color: Colors.grey),
                        ),
                    ],
                  ),
                  isThreeLine: true,
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: Icon(
                          Icons.calendar_month,
                          color: appt != null
                              ? Colors.blue.shade700
                              : Colors.grey,
                        ),
                        tooltip: 'Edit appointment',
                        onPressed: () =>
                            _showAppointmentSheet(stop),
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline,
                            color: Colors.red),
                        tooltip: 'Remove stop',
                        onPressed: () {
                          setState(() {
                            _appointments.remove(stop.id);
                            _stops.removeAt(i);
                          });
                        },
                      ),
                    ],
                  ),
                ),
              );
            },
          ),

          // Add stop button
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: OutlinedButton.icon(
              icon: const Icon(Icons.add_location_alt),
              label: const Text('Add Stop'),
              onPressed: _showAddStopDialog,
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        icon: const Icon(Icons.route),
        label: const Text('Build Route'),
        onPressed: () {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                  'Route building: connect to navigation screen'),
            ),
          );
        },
      ),
    );
  }
}

// ── Appointment warning banner widget ─────────────────────────────────────

class _AppointmentWarningBanner extends StatelessWidget {
  const _AppointmentWarningBanner({
    required this.color,
    required this.icon,
    required this.message,
  });

  final Color color;
  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.18),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        children: [
          Icon(icon, color: Colors.white, size: 26),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
