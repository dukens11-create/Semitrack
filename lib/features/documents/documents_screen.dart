/// Full-featured trip documents panel.
///
/// Allows drivers and dispatchers to attach and manage key freight paperwork
/// for each trip:
///   • Rate Confirmation  (RC)
///   • Bill of Lading     (BOL)
///   • Proof of Delivery  (POD)
///   • Other              (free-form)
///
/// Documents are persisted in [SharedPreferences] so they survive app restarts.
/// The list can be filtered by [activeTripId] so drivers only see paperwork for
/// the current load.  A [FloatingActionButton] opens an "Add document" bottom
/// sheet; tapping any row opens a detail/edit view.
///
/// Designed to be extensible: add new [DocType] values in trip_document.dart
/// and the rest of the UI adapts automatically.
library;

import 'dart:math';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../models/trip_document.dart';

/// The primary trip documents screen.
///
/// Pass [activeTripId] to pre-filter the list to a specific trip.  When
/// [activeTripId] is null or empty the full unfiltered list is shown.
class TripDocumentsScreen extends StatefulWidget {
  const TripDocumentsScreen({super.key, this.activeTripId});

  /// Trip identifier used to filter the document list.
  ///
  /// Set this to the trip/load ID that is currently active in the navigation
  /// screen so the driver only sees paperwork for the current haul.
  final String? activeTripId;

  @override
  State<TripDocumentsScreen> createState() => _TripDocumentsScreenState();
}

class _TripDocumentsScreenState extends State<TripDocumentsScreen> {
  // ── Persisted document list ───────────────────────────────────────────────
  List<TripDocument> _allDocs = [];

  // ── Active trip filter ────────────────────────────────────────────────────
  /// When non-null / non-empty only documents matching this trip ID are shown.
  String _filterTripId = '';

  // ── Loading state ─────────────────────────────────────────────────────────
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    // Pre-populate the filter from the widget property if provided.
    _filterTripId = widget.activeTripId ?? '';
    _loadDocs();
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  /// Loads the saved document list from [SharedPreferences].
  Future<void> _loadDocs() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(TripDocument.prefKey);
    setState(() {
      _allDocs = TripDocument.listFromJson(raw);
      _loading = false;
    });
  }

  /// Writes the current [_allDocs] list to [SharedPreferences].
  Future<void> _saveDocs() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
        TripDocument.prefKey, TripDocument.listToJson(_allDocs));
  }

  // ── Derived / filtered view ───────────────────────────────────────────────

  /// Returns only the documents that match the current [_filterTripId].
  ///
  /// When [_filterTripId] is empty, all documents are returned (no filter).
  List<TripDocument> get _visibleDocs {
    if (_filterTripId.isEmpty) return _allDocs;
    return _allDocs.where((d) => d.tripId == _filterTripId).toList();
  }

  /// Sorted unique list of trip IDs found across all documents — used to
  /// populate the filter chip row at the top of the screen.
  List<String> get _allTripIds {
    final ids = _allDocs
        .map((d) => d.tripId)
        .where((id) => id.isNotEmpty)
        .toSet()
        .toList();
    ids.sort();
    return ids;
  }

  // ── CRUD helpers ──────────────────────────────────────────────────────────

  /// Adds [doc] to the list and persists.
  Future<void> _addDoc(TripDocument doc) async {
    setState(() => _allDocs.add(doc));
    await _saveDocs();
  }

  /// Replaces the document with the same [id] and persists.
  Future<void> _updateDoc(TripDocument updated) async {
    setState(() {
      final i = _allDocs.indexWhere((d) => d.id == updated.id);
      if (i >= 0) _allDocs[i] = updated;
    });
    await _saveDocs();
  }

  /// Deletes the document with [id] from the list and persists.
  Future<void> _deleteDoc(String id) async {
    setState(() => _allDocs.removeWhere((d) => d.id == id));
    await _saveDocs();
  }

  // ── Bottom sheets ─────────────────────────────────────────────────────────

  /// Opens the "Add document" bottom sheet and awaits the result.
  Future<void> _openAddSheet() async {
    final doc = await showModalBottomSheet<TripDocument>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _DocEditSheet(
        initialTripId: _filterTripId,
      ),
    );
    if (doc != null) await _addDoc(doc);
  }

  /// Opens the document detail / edit bottom sheet for [doc].
  Future<void> _openDetailSheet(TripDocument doc) async {
    final result = await showModalBottomSheet<_DocSheetResult>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _DocDetailSheet(doc: doc),
    );
    if (result == null) return;
    if (result.delete) {
      await _deleteDoc(doc.id);
    } else if (result.updated != null) {
      await _updateDoc(result.updated!);
    }
  }

  // ── Build helpers ─────────────────────────────────────────────────────────

  /// Returns the [Color] accent associated with each [DocType].
  static Color typeColor(DocType t) {
    switch (t) {
      case DocType.rateConfirmation:
        return Colors.indigo.shade600;
      case DocType.bol:
        return Colors.teal.shade700;
      case DocType.pod:
        return Colors.green.shade700;
      case DocType.other:
        return Colors.orange.shade700;
    }
  }

  /// Returns the [IconData] badge shown in the leading circle for each [DocType].
  static IconData typeIcon(DocType t) {
    switch (t) {
      case DocType.rateConfirmation:
        return Icons.request_quote;
      case DocType.bol:
        return Icons.inventory_2;
      case DocType.pod:
        return Icons.fact_check;
      case DocType.other:
        return Icons.description;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // The screen is embedded inside GoRouter's ShellRoute (AppLayout
      // supplies the AppBar).  When used standalone the appBar here acts
      // as a header.
      appBar: AppBar(
        title: const Text('Trip Documents'),
        backgroundColor: Colors.blue.shade700,
        foregroundColor: Colors.white,
      ),
      floatingActionButton: FloatingActionButton(
        // heroTag keeps the FAB from conflicting with the map screen's FABs
        // when this screen is pushed on top of TruckMapScreen.
        heroTag: 'docs_add_fab',
        tooltip: 'Add document',
        backgroundColor: Colors.blue.shade700,
        onPressed: _openAddSheet,
        child: const Icon(Icons.add, color: Colors.white),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ── Trip filter chips ──────────────────────────────────────
                if (_allTripIds.isNotEmpty) _buildFilterRow(),
                // ── Document list ──────────────────────────────────────────
                Expanded(
                  child: _visibleDocs.isEmpty
                      ? _buildEmptyState()
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(
                              vertical: 8, horizontal: 12),
                          itemCount: _visibleDocs.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 6),
                          itemBuilder: (_, i) =>
                              _buildDocTile(_visibleDocs[i]),
                        ),
                ),
              ],
            ),
    );
  }

  /// Builds the horizontal trip-filter chip row.
  Widget _buildFilterRow() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
      child: Row(
        children: [
          // "All" chip — clears the filter.
          FilterChip(
            label: const Text('All'),
            selected: _filterTripId.isEmpty,
            onSelected: (_) => setState(() => _filterTripId = ''),
          ),
          const SizedBox(width: 8),
          // One chip per trip ID found in the document list.
          for (final id in _allTripIds) ...[
            FilterChip(
              label: Text('Trip $id'),
              selected: _filterTripId == id,
              onSelected: (_) => setState(
                  () => _filterTripId = _filterTripId == id ? '' : id),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }

  /// Builds a single document card / list tile.
  Widget _buildDocTile(TripDocument doc) {
    final color = typeColor(doc.type);
    return Card(
      elevation: 1.5,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        // ── Leading icon badge ───────────────────────────────────────────
        leading: CircleAvatar(
          backgroundColor: color,
          child: Icon(typeIcon(doc.type), color: Colors.white, size: 20),
        ),
        // ── Title ────────────────────────────────────────────────────────
        title: Text(
          doc.title,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        // ── Subtitle: type abbreviation + optional trip badge ─────────────
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 2),
            Row(
              children: [
                // Type label chip.
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    doc.type.abbreviation,
                    style: TextStyle(
                      color: color,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                // Trip ID badge (when set).
                if (doc.tripId.isNotEmpty) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.grey.shade200,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'Trip ${doc.tripId}',
                      style: const TextStyle(
                        fontSize: 11,
                        color: Colors.black54,
                      ),
                    ),
                  ),
                ],
              ],
            ),
            // Optional note preview.
            if (doc.note.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                doc.note,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12, color: Colors.black54),
              ),
            ],
          ],
        ),
        trailing: const Icon(Icons.chevron_right, color: Colors.grey),
        onTap: () => _openDetailSheet(doc),
      ),
    );
  }

  /// Placeholder shown when no documents match the active filter.
  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.folder_open, size: 64, color: Colors.grey.shade300),
          const SizedBox(height: 12),
          Text(
            _filterTripId.isEmpty
                ? 'No documents yet.\nTap + to add one.'
                : 'No documents for Trip $_filterTripId.\nTap + to add one.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey.shade500, fontSize: 15),
          ),
        ],
      ),
    );
  }
}

// ── Doc detail / edit bottom sheet ────────────────────────────────────────────

/// Result returned from [_DocDetailSheet].
class _DocSheetResult {
  const _DocSheetResult({this.updated, this.delete = false});
  final TripDocument? updated;
  final bool delete;
}

/// Bottom sheet that displays full details for [doc] and allows editing or
/// deletion.  Returns a [_DocSheetResult] with the updated doc or a delete
/// flag.
class _DocDetailSheet extends StatefulWidget {
  const _DocDetailSheet({required this.doc});
  final TripDocument doc;

  @override
  State<_DocDetailSheet> createState() => _DocDetailSheetState();
}

class _DocDetailSheetState extends State<_DocDetailSheet> {
  late final TextEditingController _titleCtrl;
  late final TextEditingController _fileRefCtrl;
  late final TextEditingController _noteCtrl;
  late final TextEditingController _tripIdCtrl;
  late DocType _selectedType;
  bool _editing = false;

  @override
  void initState() {
    super.initState();
    final d = widget.doc;
    _titleCtrl = TextEditingController(text: d.title);
    _fileRefCtrl = TextEditingController(text: d.fileRef);
    _noteCtrl = TextEditingController(text: d.note);
    _tripIdCtrl = TextEditingController(text: d.tripId);
    _selectedType = d.type;
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _fileRefCtrl.dispose();
    _noteCtrl.dispose();
    _tripIdCtrl.dispose();
    super.dispose();
  }

  void _save() {
    final updated = widget.doc.copyWith(
      title: _titleCtrl.text.trim(),
      tripId: _tripIdCtrl.text.trim(),
      type: _selectedType,
      fileRef: _fileRefCtrl.text.trim(),
      note: _noteCtrl.text.trim(),
    );
    Navigator.of(context).pop(_DocSheetResult(updated: updated));
  }

  void _confirmDelete() {
    Navigator.of(context).pop(const _DocSheetResult(delete: true));
  }

  @override
  Widget build(BuildContext context) {
    final color = _TripDocumentsScreenState.typeColor(widget.doc.type);
    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 32,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Sheet handle ──────────────────────────────────────────────
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),
            // ── Header row: icon + title ──────────────────────────────────
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: color,
                  child: Icon(
                    _TripDocumentsScreenState.typeIcon(widget.doc.type),
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    widget.doc.title.isNotEmpty
                        ? widget.doc.title
                        : '(untitled)',
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ),
                // Edit toggle button.
                IconButton(
                  icon: Icon(_editing ? Icons.close : Icons.edit),
                  tooltip: _editing ? 'Cancel edit' : 'Edit document',
                  onPressed: () => setState(() => _editing = !_editing),
                ),
              ],
            ),
            const SizedBox(height: 20),

            if (!_editing) ...[
              // ── Read-only detail rows ──────────────────────────────────
              _detailRow(Icons.category, 'Type', widget.doc.type.label),
              if (widget.doc.tripId.isNotEmpty)
                _detailRow(Icons.route, 'Trip ID', widget.doc.tripId),
              if (widget.doc.fileRef.isNotEmpty)
                _detailRow(Icons.attach_file, 'File', widget.doc.fileRef),
              if (widget.doc.note.isNotEmpty)
                _detailRow(Icons.notes, 'Note', widget.doc.note),
              _detailRow(
                Icons.access_time,
                'Added',
                _formatDate(widget.doc.createdAt),
              ),
              const SizedBox(height: 24),
              // Delete button.
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.delete_outline, color: Colors.red),
                  label: const Text('Delete Document',
                      style: TextStyle(color: Colors.red)),
                  onPressed: _confirmDelete,
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Colors.red),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
            ] else ...[
              // ── Editable fields ──────────────────────────────────────────
              _buildEditFields(),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _save,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.blue.shade700,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('Save Changes',
                      style: TextStyle(fontSize: 16)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Builds a single icon + label + value row for read-only mode.
  Widget _detailRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: Colors.grey.shade600),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style:
                        const TextStyle(fontSize: 11, color: Colors.grey)),
                const SizedBox(height: 2),
                Text(value, style: const TextStyle(fontSize: 14)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Builds the edit-mode form fields.
  Widget _buildEditFields() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Document title.
        TextField(
          controller: _titleCtrl,
          decoration: const InputDecoration(
            labelText: 'Title *',
            border: OutlineInputBorder(),
            prefixIcon: Icon(Icons.title),
          ),
        ),
        const SizedBox(height: 12),
        // Document type dropdown.
        DropdownButtonFormField<DocType>(
          value: _selectedType,
          decoration: const InputDecoration(
            labelText: 'Type *',
            border: OutlineInputBorder(),
            prefixIcon: Icon(Icons.category),
          ),
          items: DocType.values
              .map((t) => DropdownMenuItem(
                    value: t,
                    child: Text(t.label),
                  ))
              .toList(),
          onChanged: (v) {
            if (v != null) setState(() => _selectedType = v);
          },
        ),
        const SizedBox(height: 12),
        // Trip ID.
        TextField(
          controller: _tripIdCtrl,
          decoration: const InputDecoration(
            labelText: 'Trip / Load ID',
            border: OutlineInputBorder(),
            prefixIcon: Icon(Icons.route),
          ),
        ),
        const SizedBox(height: 12),
        // File reference.
        TextField(
          controller: _fileRefCtrl,
          decoration: const InputDecoration(
            labelText: 'File Reference (path or URI)',
            border: OutlineInputBorder(),
            prefixIcon: Icon(Icons.attach_file),
          ),
        ),
        const SizedBox(height: 12),
        // Free-text note.
        TextField(
          controller: _noteCtrl,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Note',
            alignLabelWithHint: true,
            border: OutlineInputBorder(),
            prefixIcon: Icon(Icons.notes),
          ),
        ),
      ],
    );
  }

  /// Formats [dt] as a short date-time string.
  String _formatDate(DateTime dt) =>
      '${dt.year}-${dt.month.toString().padLeft(2, '0')}-'
      '${dt.day.toString().padLeft(2, '0')} '
      '${dt.hour.toString().padLeft(2, '0')}:'
      '${dt.minute.toString().padLeft(2, '0')}';
}

// ── Add document bottom sheet ─────────────────────────────────────────────────

/// Bottom sheet for creating a new [TripDocument].
///
/// Returns the completed [TripDocument] on save, or null on dismiss.
class _DocEditSheet extends StatefulWidget {
  const _DocEditSheet({this.initialTripId = ''});
  final String initialTripId;

  @override
  State<_DocEditSheet> createState() => _DocEditSheetState();
}

class _DocEditSheetState extends State<_DocEditSheet> {
  final _titleCtrl = TextEditingController();
  final _fileRefCtrl = TextEditingController();
  final _noteCtrl = TextEditingController();
  late final TextEditingController _tripIdCtrl;
  DocType _selectedType = DocType.rateConfirmation;

  @override
  void initState() {
    super.initState();
    _tripIdCtrl = TextEditingController(text: widget.initialTripId);
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _fileRefCtrl.dispose();
    _noteCtrl.dispose();
    _tripIdCtrl.dispose();
    super.dispose();
  }

  void _save() {
    final title = _titleCtrl.text.trim();
    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a document title.')),
      );
      return;
    }
    final doc = TripDocument(
      // Use a random 8-char hex ID.  In production swap for a proper UUID.
      id: _generateId(),
      tripId: _tripIdCtrl.text.trim(),
      title: title,
      type: _selectedType,
      fileRef: _fileRefCtrl.text.trim(),
      note: _noteCtrl.text.trim(),
    );
    Navigator.of(context).pop(doc);
  }

  /// Generates a short random ID suitable for demo/development use.
  String _generateId() {
    final r = Random.secure();
    return List.generate(8, (_) => r.nextInt(16).toRadixString(16)).join();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 32,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Sheet handle ──────────────────────────────────────────────
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Add Document',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            // ── Title ─────────────────────────────────────────────────────
            TextField(
              controller: _titleCtrl,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Title *',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.title),
              ),
            ),
            const SizedBox(height: 12),
            // ── Document type ─────────────────────────────────────────────
            DropdownButtonFormField<DocType>(
              value: _selectedType,
              decoration: const InputDecoration(
                labelText: 'Type *',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.category),
              ),
              items: DocType.values
                  .map((t) => DropdownMenuItem(
                        value: t,
                        child: Text(t.label),
                      ))
                  .toList(),
              onChanged: (v) {
                if (v != null) setState(() => _selectedType = v);
              },
            ),
            const SizedBox(height: 12),
            // ── Trip / load ID ────────────────────────────────────────────
            TextField(
              controller: _tripIdCtrl,
              decoration: const InputDecoration(
                labelText: 'Trip / Load ID',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.route),
              ),
            ),
            const SizedBox(height: 12),
            // ── File reference ────────────────────────────────────────────
            TextField(
              controller: _fileRefCtrl,
              decoration: const InputDecoration(
                labelText: 'File Reference (path or URI)',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.attach_file),
                hintText: '/storage/emulated/0/…  or  content://…',
              ),
            ),
            const SizedBox(height: 12),
            // ── Note ──────────────────────────────────────────────────────
            TextField(
              controller: _noteCtrl,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Note',
                alignLabelWithHint: true,
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.notes),
                hintText: 'e.g. Signed by Jane at dock 4',
              ),
            ),
            const SizedBox(height: 20),
            // ── Save button ───────────────────────────────────────────────
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                icon: const Icon(Icons.save),
                label: const Text('Save Document',
                    style: TextStyle(fontSize: 16)),
                onPressed: _save,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blue.shade700,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Backwards-compatible alias ─────────────────────────────────────────────────
// Keep the original class name so existing GoRouter routes and AppShell
// references that import this file continue to compile without changes.
//
// Remove this alias once all call-sites have been migrated to
// TripDocumentsScreen.
typedef DocumentsScreen = TripDocumentsScreen;
