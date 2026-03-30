/// Trip document model for attaching paperwork to a load/trip.
///
/// Supports the four standard freight document types used in real trucking
/// workflows:
///   - Rate Confirmation (rateConfirmation) — the rate con from the broker/shipper
///   - Bill of Lading    (bol)              — signed at pickup
///   - Proof of Delivery (pod)              — signed at delivery
///   - Other             (other)            — any additional paperwork
///
/// Documents are persisted as a JSON list in SharedPreferences under the key
/// [TripDocument.prefKey].  Call [TripDocument.listToJson] /
/// [TripDocument.listFromJson] to serialise/deserialise the full collection.
library;

import 'dart:convert';

/// The four standard freight document categories.
enum DocType {
  rateConfirmation,
  bol,
  pod,
  other;

  /// Human-readable label shown in the UI.
  String get label {
    switch (this) {
      case DocType.rateConfirmation:
        return 'Rate Confirmation';
      case DocType.bol:
        return 'Bill of Lading (BOL)';
      case DocType.pod:
        return 'Proof of Delivery (POD)';
      case DocType.other:
        return 'Other';
    }
  }

  /// Short abbreviation used in list tiles.
  String get abbreviation {
    switch (this) {
      case DocType.rateConfirmation:
        return 'RC';
      case DocType.bol:
        return 'BOL';
      case DocType.pod:
        return 'POD';
      case DocType.other:
        return 'Other';
    }
  }
}

/// A single trip document record.
///
/// [id]      — unique UUID-like key, set once at creation time.
/// [tripId]  — ID of the trip this document belongs to; empty string means
///             "not yet assigned to a trip" (shown in unfiltered list).
/// [title]   — driver-supplied document title, e.g. "Load #4201 Rate Con".
/// [type]    — one of the four [DocType] values.
/// [fileRef] — local file path or URI returned by a file picker; may be an
///             empty string when the driver records metadata without a file.
/// [note]    — free-text note, e.g. "Signed by John at dock 3".
/// [createdAt] — ISO-8601 timestamp set when the document is first saved.
class TripDocument {
  /// SharedPreferences key under which the JSON list is stored.
  static const String prefKey = 'trip_documents_v1';

  TripDocument({
    required this.id,
    required this.tripId,
    required this.title,
    required this.type,
    this.fileRef = '',
    this.note = '',
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  final String id;
  final String tripId;
  final String title;
  final DocType type;
  final String fileRef;
  final String note;
  final DateTime createdAt;

  // ── Serialisation ──────────────────────────────────────────────────────────

  /// Serialises this document to a JSON-compatible map.
  Map<String, dynamic> toJson() => {
        'id': id,
        'tripId': tripId,
        'title': title,
        'type': type.name,
        'fileRef': fileRef,
        'note': note,
        'createdAt': createdAt.toIso8601String(),
      };

  /// Deserialises a document from a JSON map.
  ///
  /// Unknown [DocType] values fall back to [DocType.other] for forward
  /// compatibility when the app is updated with new types.
  factory TripDocument.fromJson(Map<String, dynamic> json) {
    final typeName = json['type'] as String? ?? '';
    final type = DocType.values.firstWhere(
      (e) => e.name == typeName,
      orElse: () => DocType.other,
    );
    return TripDocument(
      id: json['id'] as String,
      tripId: json['tripId'] as String? ?? '',
      title: json['title'] as String? ?? '',
      type: type,
      fileRef: json['fileRef'] as String? ?? '',
      note: json['note'] as String? ?? '',
      createdAt: json['createdAt'] != null
          ? DateTime.tryParse(json['createdAt'] as String) ?? DateTime.now()
          : DateTime.now(),
    );
  }

  // ── List helpers for SharedPreferences ────────────────────────────────────

  /// Encodes a list of documents to a JSON string for storage.
  static String listToJson(List<TripDocument> docs) =>
      jsonEncode(docs.map((d) => d.toJson()).toList());

  /// Decodes a JSON string produced by [listToJson] back to a list.
  ///
  /// Returns an empty list if the string is null, empty, or malformed.
  static List<TripDocument> listFromJson(String? raw) {
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = jsonDecode(raw) as List<dynamic>;
      return list
          .whereType<Map<String, dynamic>>()
          .map(TripDocument.fromJson)
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Creates a copy of this document with the given fields replaced.
  TripDocument copyWith({
    String? id,
    String? tripId,
    String? title,
    DocType? type,
    String? fileRef,
    String? note,
    DateTime? createdAt,
  }) {
    return TripDocument(
      id: id ?? this.id,
      tripId: tripId ?? this.tripId,
      title: title ?? this.title,
      type: type ?? this.type,
      fileRef: fileRef ?? this.fileRef,
      note: note ?? this.note,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
