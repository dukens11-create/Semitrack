import 'package:flutter/material.dart';

class DocumentsScreen extends StatelessWidget {
  const DocumentsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const docs = [
      ('invoice-1001.pdf', 'Invoice'),
      ('pod-4021.pdf', 'POD'),
      ('settlement-0932.pdf', 'Settlement'),
    ];

    return ListView(
      children: [
        for (final d in docs)
          Card(
            margin: const EdgeInsets.all(12),
            child: ListTile(
              leading: const Icon(Icons.description),
              title: Text(d.$1),
              subtitle: Text(d.$2),
              trailing: const Icon(Icons.upload_file),
            ),
          ),
      ],
    );
  }
}
