import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import type { AllocationDetailDto, BillDto } from '@shared/api';
import { buildWhatsAppMessage, type WhatsAppLanguage } from '@shared/whatsapp';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/form';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';

export function whatsAppText(allocation: AllocationDetailDto, bill: BillDto, buildingName: string, language: WhatsAppLanguage): string {
  const totalKwh = allocation.totalKwh ?? bill.electricityKwh;
  const electricity = allocation.totalElectricityAmount ?? bill.electricityAmount;
  return buildWhatsAppMessage(
    {
      buildingName,
      periodStart: bill.periodStart,
      periodEnd: bill.periodEnd,
      totalKwh,
      electricityAmount: electricity,
      waterAmount: allocation.totalWaterAmount ?? bill.waterAmount,
      totalAmount: allocation.totalAmount ?? bill.totalAmount,
      effectivePricePerKwh: allocation.effectivePricePerKwh ?? electricity / totalKwh,
      consumers: [...allocation.items]
        .sort((a, b) => a.order - b.order)
        .map((i) => ({ name: i.consumerName, kwh: i.kwh, provenance: i.provenance, totalAmount: i.totalAmount, payableAmount: i.payableAmount })),
    },
    language,
  );
}

/** Message prêt à coller dans WhatsApp, généré depuis une répartition enregistrée. */
export function WhatsAppShare({ allocation, bill, buildingName }: { allocation: AllocationDetailDto; bill: BillDto; buildingName: string }) {
  const t = useT();
  const toast = useToast();
  const [language, setLanguage] = useState<WhatsAppLanguage>('mg');
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState(false);
  const text = whatsAppText(allocation, bill, buildingName, language);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFallback(false);
      toast.success(t('whatsapp.copied'));
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setFallback(true);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        value={language}
        onChange={setLanguage}
        items={[
          { value: 'mg', label: t('whatsapp.lang.mg') },
          { value: 'fr', label: t('whatsapp.lang.fr') },
        ]}
      />
      <pre className="max-h-80 overflow-auto rounded-lg bg-emerald-50 p-3 text-sm whitespace-pre-wrap text-slate-800">{text}</pre>
      {fallback ? (
        <>
          <Alert variant="info">{t('whatsapp.copyFallback')}</Alert>
          <Textarea readOnly value={text} rows={10} onFocus={(e) => e.currentTarget.select()} autoFocus />
        </>
      ) : null}
      <Button onClick={() => void copy()} className="bg-emerald-600 hover:bg-emerald-700">
        {copied ? <Check /> : <Copy />} {t('whatsapp.copy')}
      </Button>
    </div>
  );
}
