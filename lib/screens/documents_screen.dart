import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme/semitrack_theme.dart';
import '../widgets/semitrack_ui.dart';

class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  static const _storageKey = 'semitrack.document_records.v1';
  static const _categories = [
    'All',
    'Rate con',
    'BOL',
    'POD',
    'Permit',
    'Note',
  ];

  List<_DocumentRecord> _records = const [];
  bool _loading = true;
  String _category = 'All';

  List<_DocumentRecord> get _visibleRecords => _category == 'All'
      ? _records
      : _records.where((record) => record.category == _category).toList();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final preferences = await SharedPreferences.getInstance();
    final raw = preferences.getString(_storageKey);
    var records = <_DocumentRecord>[];
    if (raw != null && raw.isNotEmpty) {
      try {
        records = (jsonDecode(raw) as List)
            .map(
              (item) => _DocumentRecord.fromJson(
                Map<String, dynamic>.from(item as Map),
              ),
            )
            .toList();
      } catch (_) {
        records = <_DocumentRecord>[];
      }
    }
    records.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    if (mounted) {
      setState(() {
        _records = records;
        _loading = false;
      });
    }
  }

  Future<void> _persist(List<_DocumentRecord> records) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(
      _storageKey,
      jsonEncode(records.map((record) => record.toJson()).toList()),
    );
  }

  Future<void> _addRecord() async {
    final draft = await _showRecordSheet();
    if (draft == null) return;
    final updated = [
      _DocumentRecord(
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        title: draft.title,
        category: draft.category,
        reference: draft.reference,
        notes: draft.notes,
        createdAt: DateTime.now(),
      ),
      ..._records,
    ];
    setState(() {
      _records = updated;
      _category = 'All';
    });
    await _persist(updated);
  }

  Future<void> _deleteRecord(_DocumentRecord record) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete document record?'),
        content: Text('“${record.title}” will be removed from this device.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final updated = _records.where((item) => item.id != record.id).toList();
    setState(() => _records = updated);
    await _persist(updated);
  }

  Future<_DocumentDraft?> _showRecordSheet() async {
    return showModalBottomSheet<_DocumentDraft>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _AddDocumentSheet(
        categories: _categories.where((item) => item != 'All').toList(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _addRecord,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add record'),
      ),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 104),
                children: [
                  Text(
                    'Documents',
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Rate confirmations, bills of lading, PODs, permits, and notes.',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(
                        context,
                      ).colorScheme.onSurface.withOpacity(0.62),
                    ),
                  ),
                  const SizedBox(height: 20),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        for (final item in _categories) ...[
                          ChoiceChip(
                            label: Text(item),
                            selected: _category == item,
                            onSelected: (_) => setState(() => _category = item),
                          ),
                          const SizedBox(width: 8),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (_visibleRecords.isEmpty)
                    DriverEmptyState(
                      icon: Icons.folder_open_rounded,
                      title: _records.isEmpty
                          ? 'Your road paperwork, organized'
                          : 'No $_category records',
                      message: _records.isEmpty
                          ? 'Create an offline record for a BOL, POD, rate confirmation, permit, or driver note.'
                          : 'Choose another document type or add a new record.',
                      actionLabel: 'Add document record',
                      onAction: _addRecord,
                    )
                  else
                    for (final record in _visibleRecords) ...[
                      _DocumentRecordCard(
                        record: record,
                        onDelete: () => _deleteRecord(record),
                      ),
                      const SizedBox(height: 10),
                    ],
                ],
              ),
      ),
    );
  }
}

class _AddDocumentSheet extends StatefulWidget {
  const _AddDocumentSheet({required this.categories});

  final List<String> categories;

  @override
  State<_AddDocumentSheet> createState() => _AddDocumentSheetState();
}

class _AddDocumentSheetState extends State<_AddDocumentSheet> {
  final _title = TextEditingController();
  final _reference = TextEditingController();
  final _notes = TextEditingController();
  String _category = 'BOL';
  bool _showTitleError = false;

  @override
  void dispose() {
    _title.dispose();
    _reference.dispose();
    _notes.dispose();
    super.dispose();
  }

  void _save() {
    final title = _title.text.trim();
    if (title.isEmpty) {
      setState(() => _showTitleError = true);
      return;
    }
    Navigator.pop(
      context,
      _DocumentDraft(
        title: title,
        category: _category,
        reference: _reference.text.trim(),
        notes: _notes.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        18,
        12,
        18,
        18 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Center(
              child: Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: Theme.of(context).dividerColor,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            const SizedBox(height: 18),
            Text(
              'Add document record',
              style: Theme.of(
                context,
              ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 6),
            Text(
              'Keep the reference and notes available offline on this device.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(
                  context,
                ).colorScheme.onSurface.withOpacity(0.62),
              ),
            ),
            const SizedBox(height: 20),
            DropdownButtonFormField<String>(
              initialValue: _category,
              decoration: const InputDecoration(labelText: 'Document type'),
              items: widget.categories
                  .map(
                    (item) => DropdownMenuItem(value: item, child: Text(item)),
                  )
                  .toList(),
              onChanged: (value) {
                if (value != null) setState(() => _category = value);
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _title,
              autofocus: true,
              textInputAction: TextInputAction.next,
              onChanged: (_) {
                if (_showTitleError) setState(() => _showTitleError = false);
              },
              decoration: InputDecoration(
                labelText: 'Title',
                hintText: 'Delivery to Reno DC',
                errorText: _showTitleError ? 'Enter a title' : null,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _reference,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: 'Reference number (optional)',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notes,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Notes (optional)',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: _save,
              icon: const Icon(Icons.save_rounded),
              label: const Text('Save record'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DocumentRecordCard extends StatelessWidget {
  const _DocumentRecordCard({required this.record, required this.onDelete});

  final _DocumentRecord record;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final date = record.createdAt.toLocal();
    final dateLabel = '${date.month}/${date.day}/${date.year}';
    return DriverCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: SemiTrackColors.blue.withOpacity(0.12),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(
              Icons.description_rounded,
              color: SemiTrackColors.blue,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    StatusPill(
                      label: record.category,
                      color: SemiTrackColors.blue,
                    ),
                    const Spacer(),
                    Text(
                      dateLabel,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  record.title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                if (record.reference.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text('Reference ${record.reference}'),
                ],
                if (record.notes.isNotEmpty) ...[
                  const SizedBox(height: 5),
                  Text(
                    record.notes,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ],
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'Document actions',
            onSelected: (value) {
              if (value == 'delete') onDelete();
            },
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'delete', child: Text('Delete')),
            ],
          ),
        ],
      ),
    );
  }
}

class _DocumentDraft {
  const _DocumentDraft({
    required this.title,
    required this.category,
    required this.reference,
    required this.notes,
  });

  final String title;
  final String category;
  final String reference;
  final String notes;
}

class _DocumentRecord {
  const _DocumentRecord({
    required this.id,
    required this.title,
    required this.category,
    required this.reference,
    required this.notes,
    required this.createdAt,
  });

  final String id;
  final String title;
  final String category;
  final String reference;
  final String notes;
  final DateTime createdAt;

  factory _DocumentRecord.fromJson(Map<String, dynamic> json) {
    return _DocumentRecord(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString() ?? 'Untitled',
      category: json['category']?.toString() ?? 'Note',
      reference: json['reference']?.toString() ?? '',
      notes: json['notes']?.toString() ?? '',
      createdAt:
          DateTime.tryParse(json['createdAt']?.toString() ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'category': category,
    'reference': reference,
    'notes': notes,
    'createdAt': createdAt.toIso8601String(),
  };
}
