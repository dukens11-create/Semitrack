import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Image, View, StyleSheet } from 'react-native';
import { z } from 'zod';
import type { Services } from '../../app/services';
import { useStore } from '../../hooks/useStore';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverField,
  DriverTitle,
} from '../../components/DriverUI';
import { Alert } from '../../components/ThemedAlert';
import { DocumentUploadQueue, type DocumentDraft } from './DocumentUploadQueue';
import {
  documentNative,
  documentMessage,
  validateDocumentFiles,
  DOCUMENT_FILE_LIMITS,
} from './DocumentFiles';
type Body = DocumentDraft['body'];
const queues = new WeakMap<Services, Map<string, DocumentUploadQueue>>();
function queueFor(services: Services, owner: string) {
  let list = queues.get(services);
  if (!list) {
    list = new Map();
    queues.set(services, list);
  }
  let queue = list.get(owner);
  if (!queue) {
    queue = new DocumentUploadQueue(owner, services.api, () => {
      const state = services.auth.getSnapshot();
      return state.status === 'signedIn' && state.user?.id === owner;
    });
    list.set(owner, queue);
  }
  return queue;
}
function useQueue(services: Services) {
  const auth = useStore(services.auth),
    owner = auth.status === 'signedIn' ? auth.user?.id ?? '' : '';
  const queue = useMemo(() => queueFor(services, owner), [services, owner]);
  const state = useStore(queue);
  return { queue, state, owner };
}
export function DocumentPendingUploads({
  services,
  onChanged,
}: {
  services: Services;
  onChanged: () => void;
}) {
  const { queue, state, owner } = useQueue(services),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (owner)
      void queue
        .load()
        .catch(() =>
          setError(
            'Pending documents could not be opened. Unlock the device and retry.',
          ),
        );
  }, [queue, owner]);
  const pending = state.items.filter(
    i => i.state !== 'COMPLETE' && i.files.length > 0,
  );
  if (!pending.length && !error) return null;
  return (
    <DriverCard>
      <DriverTitle small>On this device</DriverTitle>
      <DriverCopy>
        Pending files are not backed up until upload is confirmed.
      </DriverCopy>
      {!!error && <DriverCopy>{error}</DriverCopy>}
      {pending.map(item => (
        <View key={item.id}>
          <DriverCopy>
            {item.body.fileName} · {item.files.length} attachment(s) ·{' '}
            {item.state === 'UPLOADING'
              ? 'Uploading'
              : item.state === 'FAILED'
              ? 'Upload failed'
              : 'Waiting for upload'}
          </DriverCopy>
          {!!item.error && <DriverCopy>{item.error}</DriverCopy>}
          {state.progress !== null && item.state === 'UPLOADING' && (
            <DriverCopy>
              Transferring {state.progress}% — awaiting storage confirmation
            </DriverCopy>
          )}
          <DriverButton
            title={'Retry upload: ' + item.body.fileName}
            disabled={busy || item.state === 'UPLOADING'}
            onPress={() => {
              setBusy(true);
              void queue
                .upload(item.id)
                .then(onChanged)
                .catch(e => setError(documentMessage(e)))
                .finally(() => setBusy(false));
            }}
          />
          <DriverButton
            title={'Discard pending files: ' + item.body.fileName}
            disabled={busy}
            onPress={() =>
              Alert.alert(
                'Discard local draft?',
                'This removes this device’s pending files. An unconfirmed server record may already exist; check My Documents.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Discard',
                    style: 'destructive',
                    onPress: () => {
                      void queue
                        .discard(item.id)
                        .then(() =>
                          documentNative.command(owner, 'remove', {
                            ids: item.files.map(f => f.id),
                          }),
                        )
                        .catch(e => setError(documentMessage(e)));
                    },
                  },
                ],
              )
            }
          />
        </View>
      ))}
    </DriverCard>
  );
}
export function DocumentAttachmentEditor({
  services,
  body,
  documentId,
  onChanged,
  onHasFiles,
  disabled = false,
}: {
  services: Services;
  body: Omit<Body, 'createOperationId'>;
  documentId?: string;
  onChanged: () => void;
  onHasFiles: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { queue, state, owner } = useQueue(services),
    [draftId, setDraftId] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const item = state.items.find(i => i.id === draftId);
  const files = item?.files ?? [];
  useEffect(() => {
    onHasFiles(files.length > 0);
  }, [files.length, onHasFiles]);
  async function pick(mode: 'camera' | 'photos' | 'files') {
    setBusy(true);
    setError('');
    try {
      const selected = await documentNative.pick(owner, mode);
      if (!selected.length) return;
      try {
        const nextFiles = [
          ...files,
          ...selected.map(f => ({ ...f, complete: false })),
        ];
        validateDocumentFiles(nextFiles);
        const id = draftId ?? (await documentNative.operation());
        await queue.save({
          id,
          body: { ...body, createOperationId: id },
          documentId,
          files: nextFiles,
          state: 'PENDING',
          attempts: 0,
          nextAttempt: 0,
        });
        setDraftId(id);
      } catch (e) {
        await documentNative
          .command(owner, 'remove', { ids: selected.map(f => f.id) })
          .catch(() => {});
        throw e;
      }
    } catch (e) {
      setError(documentMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeFiles(next: DocumentDraft['files']) {
    if (item)
      await queue.save({
        ...item,
        files: next,
        body: { ...body, createOperationId: item.id },
      });
  }
  const locked =
    busy ||
    disabled ||
    item?.state === 'UPLOADING' ||
    item?.state === 'COMPLETE';
  return (
    <DriverCard>
      <DriverTitle small>Document files</DriverTitle>
      <DriverCopy>
        Take a photo or select PDF, JPEG or PNG files. Pending files stay
        privately on this device until upload is confirmed. Maximum{' '}
        {DOCUMENT_FILE_LIMITS.singleBytes / 1048576} MB per file,{' '}
        {DOCUMENT_FILE_LIMITS.totalBytes / 1048576} MB total,{' '}
        {DOCUMENT_FILE_LIMITS.attachments} attachments. PDF page counts are not
        measured.
      </DriverCopy>
      {!documentNative.available() && (
        <DriverCopy>
          Capture and file sharing are unavailable in this native build.
        </DriverCopy>
      )}
      {(['camera', 'photos', 'files'] as const).map((mode, i) => (
        <DriverButton
          key={mode}
          title={
            [
              'Take document photo',
              'Choose document photo',
              'Upload document file',
            ][i]!
          }
          disabled={
            locked ||
            !documentNative.available() ||
            files.length >= DOCUMENT_FILE_LIMITS.attachments
          }
          onPress={() => {
            void pick(mode);
          }}
        />
      ))}
      {files.map((file, index) => (
        <View key={file.id}>
          {file.mimeType.startsWith('image/') && (
            <Image
              source={{ uri: file.uri }}
              style={styles.thumbnail}
              accessibilityLabel={'Document image ' + (index + 1)}
            />
          )}
          <DriverCopy>
            {index + 1}. {file.originalFilename} · {file.mimeType} ·{' '}
            {(file.sizeBytes / 1024).toFixed(0)} KB
          </DriverCopy>
          <DriverButton
            title={'Remove attachment ' + (index + 1)}
            disabled={locked || !!file.serverId}
            onPress={() => {
              void changeFiles(files.filter(f => f.id !== file.id))
                .then(() =>
                  documentNative.command(owner, 'remove', { ids: [file.id] }),
                )
                .catch(e => setError(documentMessage(e)));
            }}
          />
          {index > 0 && (
            <DriverButton
              title={'Move attachment ' + (index + 1) + ' up'}
              disabled={locked || files.some(f => f.serverId)}
              onPress={() => {
                const next = [...files];
                [next[index - 1], next[index]] = [
                  next[index]!,
                  next[index - 1]!,
                ];
                void changeFiles(next).catch(e => setError(documentMessage(e)));
              }}
            />
          )}
        </View>
      ))}
      {!!error && <DriverCopy>{error}</DriverCopy>}
      {!!files.length && (
        <>
          <DriverCopy>
            {item?.state === 'COMPLETE'
              ? 'Attachments saved securely.'
              : item?.error ?? 'Waiting for upload. No server backup yet.'}
          </DriverCopy>
          <DriverButton
            title={
              item?.state === 'COMPLETE'
                ? 'Attachments saved'
                : 'Save document and attachments'
            }
            disabled={locked || !body.fileName.trim()}
            onPress={() => {
              if (!item) return;
              setBusy(true);
              void queue
                .save({
                  ...item,
                  body: { ...body, createOperationId: item.id },
                })
                .then(() => queue.upload(item.id))
                .then(onChanged)
                .catch(e => setError(documentMessage(e)))
                .finally(() => setBusy(false));
            }}
          />
        </>
      )}
    </DriverCard>
  );
}
const attachment = z.object({
  id: z.string().uuid(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  checksum: z.string(),
  status: z.string(),
  pageOrder: z.number(),
});
const detailSchema = z.object({
  attachments: z.array(attachment),
  shares: z.array(
    z.object({
      id: z.string(),
      recipientType: z.string(),
      recipientValue: z.string().nullable(),
      deliveryStatus: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export function SavedDocumentFiles({
  services,
  documentId,
  onDeleted,
}: {
  services: Services;
  documentId: string;
  onDeleted: () => void;
}) {
  const { owner, queue } = useQueue(services),
    [data, setData] = useState<z.infer<typeof detailSchema>>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(''),
    [subject, setSubject] = useState('SemiTraX document'),
    [message, setMessage] = useState(
      'Please find the requested document from SemiTraX.',
    );
  const load = async () => {
    const response = detailSchema.parse(
      await services.api.request(
        'GET',
        '/documents/' + encodeURIComponent(documentId),
      ),
    );
    if (services.auth.getSnapshot().user?.id === owner) setData(response);
  };
  useEffect(() => {
    void load().catch(() =>
      setError('Attachments could not be loaded. Retry when connected.'),
    );
  }, [documentId, owner]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    void fn()
      .catch(e => setError(documentMessage(e)))
      .finally(() => setBusy(false));
  };
  async function downloaded(file: z.infer<typeof attachment>) {
    const info = z
      .object({
        url: z.string().url(),
        sizeBytes: z.number(),
        checksum: z.string(),
        mimeType: z.string(),
      })
      .parse(
        await services.api.request(
          'GET',
          '/documents/' +
            encodeURIComponent(documentId) +
            '/download?attachmentId=' +
            file.id,
        ),
      );
    return documentNative.command<{ id: string; uri: string }>(
      owner,
      'download',
      info,
    );
  }
  async function share() {
    const ids: string[] = [],
      names: string[] = [],
      types: string[] = [];
    for (const file of data?.attachments.filter(f => f.status === 'SAVED') ??
      []) {
      ids.push((await downloaded(file)).id);
      names.push(file.originalFilename);
      types.push(file.mimeType);
    }
    if (!ids.length) throw new Error('No saved attachments.');
    const opened = await documentNative.command<{ opened: boolean }>(
      owner,
      'share',
      { ids, names, mimeType: new Set(types).size === 1 ? types[0] : '*/*' },
    );
    if (!opened.opened) throw new Error('Share sheet unavailable.');
    await services.api.request(
      'POST',
      '/documents/' + encodeURIComponent(documentId) + '/share',
      { operationId: await documentNative.operation(), channel: 'SHARE_SHEET' },
    );
    await load();
  }
  const emailAttempt = useRef<{ key: string; operationId: string } | undefined>(
    undefined,
  );
  const remove = (fileId?: string) =>
    Alert.alert(
      fileId ? 'Delete attachment?' : 'Delete document?',
      'This hides the record and schedules private file cleanup. Fleet retention holds may prevent immediate erasure.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              await services.api.request(
                'DELETE',
                '/documents/' +
                  encodeURIComponent(documentId) +
                  (fileId ? '/attachments/' + fileId : ''),
              );
              if (fileId) await load();
              else onDeleted();
            }),
        },
      ],
    );
  return (
    <DriverCard>
      <DriverTitle small>Saved files and sharing</DriverTitle>
      {!documentNative.available() && (
        <DriverCopy>
          File viewing, replacement and device sharing are unavailable in this
          native build.
        </DriverCopy>
      )}
      {!!error && <DriverCopy>{error}</DriverCopy>}
      <DriverButton
        title="Refresh attachment status"
        disabled={busy}
        onPress={() => run(load)}
      />
      {data && !data.attachments.length && (
        <DriverCopy>No files are stored with this document record.</DriverCopy>
      )}
      {data?.attachments.map((file, index) => (
        <View key={file.id}>
          <DriverCopy>
            {index + 1}. {file.originalFilename} ·{' '}
            {(file.sizeBytes / 1024).toFixed(0)} KB · {file.status}
          </DriverCopy>
          <DriverButton
            title={'View attachment ' + (index + 1)}
            disabled={
              busy || !documentNative.available() || file.status !== 'SAVED'
            }
            onPress={() =>
              run(async () => {
                const local = await downloaded(file);
                await documentNative.command(owner, 'open', {
                  ids: [local.id],
                  names: [file.originalFilename],
                  mimeType: file.mimeType,
                });
              })
            }
          />
          <DriverButton
            title={'Replace attachment ' + (index + 1)}
            disabled={
              busy || !documentNative.available() || file.status !== 'SAVED'
            }
            onPress={() =>
              run(async () => {
                const selected = await documentNative.pick(owner, 'files');
                if (selected.length !== 1) {
                  await documentNative.command(owner, 'remove', {
                    ids: selected.map(f => f.id),
                  });
                  throw new Error('Select one replacement.');
                }
                const id = await documentNative.operation();
                await queue.save({
                  id,
                  documentId,
                  replaceId: file.id,
                  body: {
                    createOperationId: id,
                    type: 'GENERAL',
                    fileName: 'Replacement attachment',
                    issuedOn: null,
                    expiresOn: null,
                    truckId: null,
                  },
                  files: selected.map(f => ({ ...f, complete: false })),
                  state: 'PENDING',
                  attempts: 0,
                  nextAttempt: 0,
                });
                await queue.upload(id);
                await load();
              })
            }
          />
          <DriverButton
            title={'Delete attachment ' + (index + 1)}
            disabled={busy}
            onPress={() => remove(file.id)}
          />
        </View>
      ))}
      <DriverButton
        title="Share document using installed apps"
        disabled={
          busy ||
          !documentNative.available() ||
          !data?.attachments.some(f => f.status === 'SAVED')
        }
        onPress={() => run(share)}
      />
      <DriverCopy>
        Opening the share sheet does not confirm delivery. Email uses expiring
        private links; recipients may forward them. Malware scanning is not
        configured.
      </DriverCopy>
      <DriverField
        label="Recipient email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <DriverField
        label="Email subject"
        value={subject}
        onChangeText={setSubject}
        maxLength={150}
      />
      <DriverField
        label="Message"
        value={message}
        onChangeText={setMessage}
        maxLength={2000}
      />
      <DriverButton
        title="Send document email"
        disabled={
          busy ||
          !z.string().email().safeParse(email).success ||
          !subject.trim() ||
          !data?.attachments.some(f => f.status === 'SAVED')
        }
        onPress={() =>
          run(async () => {
            const key = JSON.stringify([documentId, email, subject, message]);
            if (emailAttempt.current?.key !== key)
              emailAttempt.current = {
                key,
                operationId: await documentNative.operation(),
              };
            await services.api.request(
              'POST',
              '/documents/' + encodeURIComponent(documentId) + '/share',
              {
                operationId: emailAttempt.current!.operationId,
                channel: 'EMAIL',
                email,
                subject,
                message,
              },
            );
            await load();
          })
        }
      />
      <DriverTitle small>Send history</DriverTitle>
      {!data?.shares.length && <DriverCopy>No recorded sends.</DriverCopy>}
      {data?.shares.map(row => (
        <DriverCopy key={row.id}>
          {row.recipientValue ?? 'Installed app'} · {row.recipientType} ·{' '}
          {new Date(row.createdAt).toLocaleString()} ·{' '}
          {row.deliveryStatus.replace(/_/g, ' ')}
        </DriverCopy>
      ))}
      <DriverButton
        title="Delete document"
        disabled={busy}
        onPress={() => remove()}
      />
    </DriverCard>
  );
}

const styles = StyleSheet.create({
  thumbnail: { width: 120, height: 150, resizeMode: 'contain' },
});
