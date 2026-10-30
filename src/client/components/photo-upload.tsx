import { Camera, FileText, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { UploadResultDto } from '@shared/api';
import type { FileKind } from '@shared/domain';
import { useT } from '@/i18n';
import { errorMessage, uploadFile } from '@/lib/api';
import { Button } from './ui/button';
import { Alert } from './ui/feedback';

/**
 * Envoi d'une photo (compteur ou facture) avec aperçu. Le résultat de la lecture automatique est
 * transmis au parent, qui doit le faire confirmer par l'utilisateur.
 */
export function PhotoUpload({
  buildingId,
  kind,
  onUploaded,
  accept = 'image/*',
}: {
  buildingId: string;
  kind: FileKind;
  onUploaded: (result: UploadResultDto) => void;
  accept?: string;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ url: string | null; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPreview({ url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null, name: file.name });
    setBusy(true);
    try {
      onUploaded(await uploadFile(buildingId, kind, file));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture={kind === 'METER_PHOTO' ? 'environment' : undefined}
        className="sr-only"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {preview ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
          {preview.url ? (
            <img src={preview.url} alt={preview.name} className="mx-auto max-h-72 w-full object-contain" />
          ) : (
            <div className="flex items-center gap-2 p-4 text-sm text-slate-600">
              <FileText className="size-5" /> {preview.name}
            </div>
          )}
        </div>
      ) : null}
      {busy ? (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="size-4 animate-spin" /> {t('photo.uploading')}
        </p>
      ) : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
        <Camera /> {preview ? t('photo.change') : t('photo.choose')}
      </Button>
    </div>
  );
}
