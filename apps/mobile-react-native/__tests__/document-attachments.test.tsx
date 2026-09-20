import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, Image } from 'react-native';
import {
  DocumentUploadQueue,
  type DocumentDraft,
} from '../src/features/documents/DocumentUploadQueue';
import {
  DocumentAttachmentEditor,
  SavedDocumentFiles,
} from '../src/features/documents/DocumentAttachments';
import { Alert } from '../src/components/ThemedAlert';
import { TextInput } from 'react-native';
import {
  documentNative,
  validateDocumentFiles,
  DOCUMENT_FILE_LIMITS,
} from '../src/features/documents/DocumentFiles';
import { DriverAppearanceContext } from '../src/features/settings/DriverPreferences';
import { Store } from '../src/state/Store';
import type { Services } from '../src/app/services';
import type { ApiClient } from '../src/services/api/ApiClient';
const disk = new Map<string, string>();
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'private' },
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => true),
}));
jest.mock('../src/native/navigation/NativeSemiTraxPlatform', () => ({
  __esModule: true,
  default: {
    documentCommand: jest.fn(),
    createOperationId: jest.fn(
      async () => '00000000-0000-4000-8000-000000000001',
    ),
  },
}));
const file = {
  id: '00000000-0000-4000-8000-000000000002',
  uri: 'file:///private/fixture',
  originalFilename: 'proof.jpg',
  mimeType: 'image/jpeg' as const,
  sizeBytes: 100,
  checksum: 'a'.repeat(64),
  complete: false,
};
const body = {
  createOperationId: '00000000-0000-4000-8000-000000000001',
  type: 'POD',
  fileName: 'Proof of delivery',
  issuedOn: null,
  expiresOn: null,
  truckId: null,
};
const draft: DocumentDraft = {
  id: body.createOperationId,
  body,
  files: [file],
  state: 'PENDING',
  attempts: 0,
  nextAttempt: 0,
};
const storage = {
  async read(owner: string) {
    return disk.get(owner) ?? null;
  },
  async write(owner: string, value: string) {
    disk.set(owner, value);
  },
};
function api() {
  const request = jest.fn(async (_method: string, path: string) =>
    path === '/documents/capabilities'
      ? { storageAvailable: true }
      : path.endsWith('/upload-init')
      ? { id: '00000000-0000-4000-8000-000000000003' }
      : path.endsWith('/upload-complete')
      ? { status: 'SAVED' }
      : { id: 'document-id' },
  );
  const uploadDocument = jest.fn(
    async (_p: string, _u: string, progress: (p: number) => void) =>
      progress(50),
  );
  return { request, uploadDocument };
}
afterEach(() => {
  disk.clear();
  jest.restoreAllMocks();
});
test.each(['day', 'night'] as const)(
  '%s saved document detail opens actual files, shares without delivery claims and confirms deletion',
  async mode => {
    const saved = { ...file, status: 'SAVED', pageOrder: 0 };
    const history = [
      {
        id: 'history',
        recipientType: 'EMAIL',
        recipientValue: 'dispatch@example.test',
        deliveryStatus: 'SENT_TO_PROVIDER',
        createdAt: '2026-09-20T12:00:00Z',
      },
    ];
    const request = jest.fn(async (method: string, path: string) => {
      if (path.includes('/download?'))
        return {
          url: 'https://private.example.test/expiring',
          sizeBytes: file.sizeBytes,
          checksum: file.checksum,
          mimeType: file.mimeType,
        };
      if (path.endsWith('/share')) return { status: 'SHARE_SHEET_OPENED' };
      if (method === 'DELETE') return { deleted: true };
      return { attachments: [saved], shares: history };
    });
    jest.spyOn(documentNative, 'available').mockReturnValue(true);
    const command = jest
      .spyOn(documentNative, 'command')
      .mockImplementation(async (_owner, action) =>
        action === 'download'
          ? ({ id: file.id, uri: file.uri } as never)
          : ({ opened: true } as never),
      );
    const services = {
      api: { request },
      auth: new Store({ status: 'signedIn', user: { id: 'saved-' + mode } }),
    } as unknown as Services;
    const deleted = jest.fn(),
      confirmation = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(
        <DriverAppearanceContext.Provider value={mode}>
          <SavedDocumentFiles
            services={services}
            documentId="saved"
            onDeleted={deleted}
          />
        </DriverAppearanceContext.Provider>,
      );
    });
    const button = (label: string) =>
      view.root.findAll(
        n => n.props.accessibilityLabel === label && n.props.onPress,
      )[0]!;
    try {
      expect(button('Send document email').props.disabled).toBe(true);
      await act(async () => button('View attachment 1').props.onPress());
      expect(command).toHaveBeenCalledWith('saved-' + mode, 'open', {
        ids: [file.id],
        names: [file.originalFilename],
        mimeType: 'image/jpeg',
      });
      await act(async () =>
        button('Share document using installed apps').props.onPress(),
      );
      expect(command).toHaveBeenCalledWith('saved-' + mode, 'share', {
        ids: [file.id],
        names: [file.originalFilename],
        mimeType: 'image/jpeg',
      });
      expect(request).toHaveBeenCalledWith(
        'POST',
        '/documents/saved/share',
        expect.objectContaining({ channel: 'SHARE_SHEET' }),
      );
      await act(async () =>
        view.root
          .findAllByType(TextInput)
          .find(n => n.props.accessibilityLabel === 'Recipient email')!
          .props.onChangeText('dispatch@example.test'),
      );
      expect(button('Send document email').props.disabled).toBe(false);
      await act(async () => button('Send document email').props.onPress());
      expect(request).toHaveBeenCalledWith(
        'POST',
        '/documents/saved/share',
        expect.objectContaining({
          channel: 'EMAIL',
          email: 'dispatch@example.test',
        }),
      );
      expect(
        view.root
          .findAllByType(Text)
          .map(n => n.props.children)
          .flat()
          .join(' '),
      ).toContain('SENT TO PROVIDER');
      await act(async () => button('Delete document').props.onPress());
      expect(
        request.mock.calls.filter(([method]) => method === 'DELETE'),
      ).toHaveLength(0);
      await act(async () =>
        confirmation.mock.calls
          .at(-1)![2]!
          .find(item => item.text === 'Delete')!.onPress!(),
      );
      expect(deleted).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => view.unmount());
    }
  },
);
test('offline captured files survive restart without claiming cloud storage', async () => {
  const client = api(),
    q = new DocumentUploadQueue(
      'owner',
      client as unknown as ApiClient,
      () => true,
      storage,
    );
  await q.save(draft);
  const restarted = new DocumentUploadQueue(
    'owner',
    client as unknown as ApiClient,
    () => true,
    storage,
  );
  await restarted.load();
  expect(restarted.getSnapshot().items[0]?.state).toBe('PENDING');
  expect(restarted.getSnapshot().items[0]?.files[0]?.uri).toBe(file.uri);
  expect(client.request).not.toHaveBeenCalled();
  const another = new DocumentUploadQueue(
    'other',
    client as unknown as ApiClient,
    () => true,
    storage,
  );
  await another.load();
  expect(another.getSnapshot().items).toEqual([]);
});
test('upload progress is real, bytes must complete, retries are idempotent', async () => {
  const client = api(),
    q = new DocumentUploadQueue(
      'owner',
      client as unknown as ApiClient,
      () => true,
      storage,
    );
  await q.save(draft);
  const seen: Array<number | null> = [];
  q.subscribe(() => seen.push(q.getSnapshot().progress));
  await q.upload(draft.id);
  expect(seen).toContain(50);
  expect(q.getSnapshot().items[0]?.state).toBe('COMPLETE');
  await q.upload(draft.id);
  expect(client.uploadDocument).toHaveBeenCalledTimes(1);
  expect(client.request).toHaveBeenCalledWith(
    'POST',
    '/documents/document-id/upload-complete',
    { attachmentId: '00000000-0000-4000-8000-000000000003' },
  );
});
test('failed upload persists FAILED and retries same operation after backoff', async () => {
  const client = api();
  client.uploadDocument.mockRejectedValueOnce(new Error('offline'));
  const q = new DocumentUploadQueue(
    'owner',
    client as unknown as ApiClient,
    () => true,
    storage,
  );
  await q.save(draft);
  await expect(q.upload(draft.id)).rejects.toThrow();
  expect(q.getSnapshot().items[0]?.state).toBe('FAILED');
  await expect(q.upload(draft.id)).rejects.toThrow('Wait briefly');
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
  await q.upload(draft.id);
  expect(q.getSnapshot().items[0]?.state).toBe('COMPLETE');
  expect(
    client.request.mock.calls.filter(([, p]) => p.endsWith('/upload-init')),
  ).toHaveLength(1);
  expect(
    client.request.mock.calls.filter(([, p]) => p === '/documents'),
  ).toHaveLength(1);
});
test('unconfigured storage and account changes cannot produce success', async () => {
  const client = api();
  client.request.mockResolvedValueOnce({ storageAvailable: false } as never);
  let current = true;
  const q = new DocumentUploadQueue(
    'owner',
    client as unknown as ApiClient,
    () => current,
    storage,
  );
  await q.save(draft);
  await expect(q.upload(draft.id)).rejects.toEqual({
    code: 'DOCUMENT_STORAGE_NOT_CONFIGURED',
  });
  expect(client.uploadDocument).not.toHaveBeenCalled();
  expect(q.getSnapshot().items[0]?.error).toContain('not configured');
  current = false;
  await expect(q.save(draft)).rejects.toThrow('Session changed');
});
test('shared file limits reject unsupported, oversized and too many files', () => {
  validateDocumentFiles([file]);
  expect(() =>
    validateDocumentFiles([{ ...file, mimeType: 'application/x-executable' }]),
  ).toThrow();
  expect(() =>
    validateDocumentFiles([{ ...file, originalFilename: '../secret.jpg' }]),
  ).toThrow();
  expect(() =>
    validateDocumentFiles([
      { ...file, sizeBytes: DOCUMENT_FILE_LIMITS.singleBytes + 1 },
    ]),
  ).toThrow();
  expect(() =>
    validateDocumentFiles(Array.from({ length: 21 }, () => file)),
  ).toThrow('DOCUMENT_PAGE_LIMIT');
});
test.each(['BOL', 'POD', 'RATE_CONFIRMATION'])(
  '%s attachment editor supports real choices, previews and remove',
  async type => {
    jest.spyOn(documentNative, 'available').mockReturnValue(true);
    jest.spyOn(documentNative, 'pick').mockResolvedValue([file]);
    jest.spyOn(documentNative, 'command').mockResolvedValue({});
    const client = api(),
      services = {
        api: client,
        auth: new Store({ status: 'signedIn', user: { id: 'ui-' + type } }),
      } as unknown as Services;
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(
        <DriverAppearanceContext.Provider value="day">
          <DocumentAttachmentEditor
            services={services}
            body={{ ...body, type }}
            onChanged={jest.fn()}
            onHasFiles={jest.fn()}
          />
        </DriverAppearanceContext.Provider>,
      );
    });
    const button = (label: string) =>
      view.root.findAll(
        n => n.props.accessibilityLabel === label && n.props.onPress,
      )[0]!;
    try {
      for (const label of [
        'Take document photo',
        'Choose document photo',
        'Upload document file',
      ])
        expect(button(label)).toBeDefined();
      await act(async () => button('Take document photo').props.onPress());
      expect(documentNative.pick).toHaveBeenCalledWith('ui-' + type, 'camera');
      expect(view.root.findByType(Image).props.source.uri).toBe(file.uri);
      expect(
        view.root
          .findAllByType(Text)
          .map(n => n.props.children)
          .flat()
          .join(' '),
      ).toContain('Waiting for upload');
      await act(async () => button('Remove attachment 1').props.onPress());
      expect(view.root.findAllByType(Image)).toHaveLength(0);
    } finally {
      await act(async () => view.unmount());
    }
  },
);

test('multiple document pages can be reordered and removed before upload', async () => {
  jest.spyOn(documentNative, 'available').mockReturnValue(true);
  const second = {
    ...file,
    id: '00000000-0000-4000-8000-000000000004',
    uri: 'file:///private/second',
    originalFilename: 'second.jpg',
  };
  jest.spyOn(documentNative, 'pick').mockResolvedValue([file, second]);
  jest.spyOn(documentNative, 'command').mockResolvedValue({});
  const client = api();
  const services = {
    api: client,
    auth: new Store({ status: 'signedIn', user: { id: 'multipage-owner' } }),
  } as unknown as Services;
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <DocumentAttachmentEditor
        services={services}
        body={body}
        onChanged={jest.fn()}
        onHasFiles={jest.fn()}
      />,
    );
  });
  const button = (label: string) =>
    view.root.findAll(
      n => n.props.accessibilityLabel === label && n.props.onPress,
    )[0]!;
  try {
    await act(async () => button('Choose document photo').props.onPress());
    expect(view.root.findAllByType(Image).map(n => n.props.source.uri)).toEqual(
      [file.uri, second.uri],
    );
    await act(async () => button('Move attachment 2 up').props.onPress());
    expect(view.root.findAllByType(Image).map(n => n.props.source.uri)).toEqual(
      [second.uri, file.uri],
    );
    await act(async () => button('Remove attachment 2').props.onPress());
    expect(view.root.findAllByType(Image).map(n => n.props.source.uri)).toEqual(
      [second.uri],
    );
    expect(documentNative.command).toHaveBeenCalledWith(
      'multipage-owner',
      'remove',
      { ids: [file.id] },
    );
    expect(client.uploadDocument).not.toHaveBeenCalled();
  } finally {
    await act(async () => view.unmount());
  }
});

test('unavailable native document support does not expose enabled file actions', async () => {
  jest.spyOn(documentNative, 'available').mockReturnValue(false);
  const client = api();
  client.request.mockResolvedValue({
    attachments: [{ ...file, status: 'SAVED', pageOrder: 0 }],
    shares: [],
  } as never);
  const services = {
    api: client,
    auth: new Store({ status: 'signedIn', user: { id: 'unsupported-owner' } }),
  } as unknown as Services;
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <SavedDocumentFiles
        services={services}
        documentId="document-id"
        onDeleted={jest.fn()}
      />,
    );
  });
  try {
    for (const label of [
      'View attachment 1',
      'Replace attachment 1',
      'Share document using installed apps',
    ]) {
      const controls = view.root.findAll(
        n => n.props.accessibilityLabel === label && n.props.onPress,
      );
      expect(controls.length).toBeGreaterThan(0);
      expect(controls[0]!.props.disabled).toBe(true);
    }
    expect(client.uploadDocument).not.toHaveBeenCalled();
  } finally {
    await act(async () => view.unmount());
  }
});
