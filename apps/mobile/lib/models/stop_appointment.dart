/// Appointment details attached to a single trip stop.
///
/// Holds the scheduled appointment window, facility contact information, and
/// any operational notes (dock number, gate code, phone number, etc.) that
/// the driver or dispatcher needs at that stop.
class StopAppointment {
  const StopAppointment({
    required this.stopId,
    required this.type,
    this.appointmentTime,
    this.earliestArrival,
    this.latestArrival,
    this.facilityName,
    this.referenceNumber,
    this.note,
  });

  /// ID of the [TripStop] this appointment belongs to.
  final String stopId;

  /// Appointment type: 'pickup' or 'delivery'.
  final String type;

  /// Exact scheduled appointment time (may be null if open / live unload).
  final DateTime? appointmentTime;

  /// Earliest allowed arrival time (start of the receiving window).
  final DateTime? earliestArrival;

  /// Latest allowed arrival time (end of the receiving window / cutoff).
  final DateTime? latestArrival;

  /// Facility or shipper/receiver name (e.g. "ABC Distribution Center").
  final String? facilityName;

  /// Carrier or shipper reference / PO / BOL number.
  final String? referenceNumber;

  /// Free-text note for dock number, gate code, phone, instructions, etc.
  final String? note;

  /// Returns true when the appointment window is fully defined and [eta]
  /// exceeds [latestArrival], indicating the driver will arrive late.
  bool isLate(DateTime eta) {
    if (latestArrival == null) return false;
    return eta.isAfter(latestArrival!);
  }

  /// Returns true when [eta] is within 30 minutes of [latestArrival] but has
  /// not yet missed the window — i.e. the driver is "at risk" of being late.
  bool isAtRisk(DateTime eta) {
    if (latestArrival == null) return false;
    final diff = latestArrival!.difference(eta);
    return diff.isNegative == false && diff.inMinutes <= 30;
  }

  StopAppointment copyWith({
    String? stopId,
    String? type,
    DateTime? appointmentTime,
    DateTime? earliestArrival,
    DateTime? latestArrival,
    String? facilityName,
    String? referenceNumber,
    String? note,
  }) {
    return StopAppointment(
      stopId: stopId ?? this.stopId,
      type: type ?? this.type,
      appointmentTime: appointmentTime ?? this.appointmentTime,
      earliestArrival: earliestArrival ?? this.earliestArrival,
      latestArrival: latestArrival ?? this.latestArrival,
      facilityName: facilityName ?? this.facilityName,
      referenceNumber: referenceNumber ?? this.referenceNumber,
      note: note ?? this.note,
    );
  }
}
