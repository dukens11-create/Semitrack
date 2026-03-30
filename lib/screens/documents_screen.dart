import 'package:flutter/material.dart';

class TripDocument {
  final String id;
  final String title;
  final String type;
  final String tripName;
  final String? note;

  TripDocument({
    required this.id,
    required this.title,
    required this.type,
    required this.tripName,
    this.note,
  });
}

class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  final List<TripDocument> _documents = [
    TripDocument(
      id: '1',
      title: 'Rate Confirmation',
      type: 'Rate Con',
      tripName: 'Portland → Sacramento',
      note: 'Broker rate confirmation received',
    ),
    TripDocument(
      id: '2',
      title: 'Bill of Lading',
      type: 'BOL',
      tripName: 'Portland → Sacramento',
      note: 'Pickup paperwork',
    ),
    TripDocument(
      id: '3',
      title: 'Proof of Delivery',
      type: 'POD',
      tripName: 'Reno → Fresno',
      note: 'Signed by receiver',
    ),
  ];

  void _addSampleDocument() {
    setState(() {
      _documents.insert(
        0,
        TripDocument(
          id: DateTime.now().millisecondsSinceEpoch.toString(),
          title: 'New Stop Note',
          type: 'Note',
          tripName: 'Seattle → Eugene',
          note: 'Call receiver 30 minutes before arrival',
        ),
      );
    });
  }

  void _deleteDocument(String id) {
    setState(() {
      _documents.removeWhere((doc) => doc.id == id);
    });
  }

  void _openDocument(TripDocument doc) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) {
        return Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                doc.title,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 10),
              Text('Type: ${doc.type}'),
              const SizedBox(height: 6),
              Text('Trip: ${doc.tripName}'),
              const SizedBox(height: 6),
              if (doc.note != null) Text('Note: ${doc.note}'),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Close'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final rateCons =
        _documents.where((d) => d.type.toLowerCase() == 'rate con').toList();
    final bols =
        _documents.where((d) => d.type.toLowerCase() == 'bol').toList();
    final pods =
        _documents.where((d) => d.type.toLowerCase() == 'pod').toList();
    final notes =
        _documents.where((d) => d.type.toLowerCase() == 'note').toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Documents'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildTopCard(),
          const SizedBox(height: 16),
          _buildSection('Rate Cons', rateCons),
          const SizedBox(height: 16),
          _buildSection('BOL', bols),
          const SizedBox(height: 16),
          _buildSection('POD', pods),
          const SizedBox(height: 16),
          _buildSection('Stop Notes', notes),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _addSampleDocument,
        icon: const Icon(Icons.add),
        label: const Text('Add Doc'),
      ),
    );
  }

  Widget _buildTopCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.black87,
        borderRadius: BorderRadius.circular(18),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Trip Documents',
            style: TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          SizedBox(height: 8),
          Text(
            'Keep rate confirmations, BOLs, PODs, and stop notes in one place.',
            style: TextStyle(
              color: Colors.white70,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSection(String title, List<TripDocument> docs) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 8),
        if (docs.isEmpty)
          _buildEmptyCard('No $title yet')
        else
          ...docs.map(
            (doc) => _buildDocCard(doc),
          ),
      ],
    );
  }

  Widget _buildEmptyCard(String text) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 15,
          color: Colors.grey,
        ),
      ),
    );
  }

  Widget _buildDocCard(TripDocument doc) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 10,
          ),
        ],
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 10,
        ),
        leading: CircleAvatar(
          child: Icon(_iconForType(doc.type)),
        ),
        title: Text(
          doc.title,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text('${doc.tripName}\n${doc.note ?? doc.type}'),
        ),
        isThreeLine: true,
        trailing: PopupMenuButton<String>(
          onSelected: (value) {
            if (value == 'open') _openDocument(doc);
            if (value == 'delete') _deleteDocument(doc.id);
          },
          itemBuilder: (context) => const [
            PopupMenuItem(
              value: 'open',
              child: Text('Open'),
            ),
            PopupMenuItem(
              value: 'delete',
              child: Text('Delete'),
            ),
          ],
        ),
        onTap: () => _openDocument(doc),
      ),
    );
  }

  IconData _iconForType(String type) {
    switch (type.toLowerCase()) {
      case 'rate con':
        return Icons.attach_money;
      case 'bol':
        return Icons.local_shipping;
      case 'pod':
        return Icons.check_circle;
      case 'note':
        return Icons.sticky_note_2;
      default:
        return Icons.description;
    }
  }
}
