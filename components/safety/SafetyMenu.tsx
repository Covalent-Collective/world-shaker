'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/useT';
import type { MessageKey } from '@/lib/i18n/types';

type ReportReason = 'harassment' | 'hateful' | 'catfish' | 'underage' | 'nsfw' | 'spam' | 'other';

const REPORT_REASONS: ReportReason[] = [
  'harassment',
  'hateful',
  'catfish',
  'underage',
  'nsfw',
  'spam',
  'other',
];

const REASON_KEY: Record<ReportReason, MessageKey> = {
  harassment: 'safety.report_reason.harassment',
  hateful: 'safety.report_reason.hateful',
  catfish: 'safety.report_reason.catfish',
  underage: 'safety.report_reason.underage',
  nsfw: 'safety.report_reason.nsfw',
  spam: 'safety.report_reason.spam',
  other: 'safety.report_reason.other',
};

interface SurfaceContext {
  match_id?: string;
  conversation_id?: string;
}

interface Props {
  surfaceContext: SurfaceContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type View = 'menu' | 'report-form';

export function SafetyMenu({ surfaceContext, open, onOpenChange }: Props) {
  const t = useT();
  const [view, setView] = useState<View>('menu');
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleClose() {
    onOpenChange(false);
    // Reset state after drawer closes
    setTimeout(() => {
      setView('menu');
      setSelectedReason(null);
      setDetail('');
    }, 300);
  }

  async function submitReport(reason: ReportReason, detailText?: string) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...surfaceContext,
          reason,
          ...(detailText ? { detail: detailText } : {}),
        }),
      });

      if (res.ok) {
        toast.success(t('safety.report'));
        handleClose();
      } else {
        const data = (await res.json()) as { error?: string };
        if (data.error === 'already_reported') {
          toast.info(t('safety.report'));
        } else {
          toast.error(t('safety.report'));
        }
        handleClose();
      }
    } catch {
      toast.error(t('safety.report'));
      handleClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBlock() {
    await submitReport('spam');
  }

  async function handleReportSubmit() {
    if (!selectedReason) return;
    await submitReport(selectedReason, detail || undefined);
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        {view === 'menu' && (
          <>
            <DrawerHeader>
              <DrawerTitle>{t('safety.report')}</DrawerTitle>
            </DrawerHeader>
            <div className="flex flex-col gap-3 px-6 pb-2">
              <Button variant="secondary" className="w-full" onClick={() => setView('report-form')}>
                {t('safety.report')}
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                onClick={handleBlock}
                disabled={submitting}
              >
                {t('safety.block')}
              </Button>
            </div>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button variant="ghost" className="w-full" onClick={handleClose}>
                  {t('safety.cancel')}
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </>
        )}

        {view === 'report-form' && (
          <>
            <DrawerHeader>
              <DrawerTitle>{t('safety.report')}</DrawerTitle>
            </DrawerHeader>
            <div className="flex flex-col gap-3 px-6 pb-2">
              <fieldset className="flex flex-col gap-2">
                {REPORT_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-text-4/30 px-4 py-3"
                  >
                    <input
                      type="radio"
                      name="report_reason"
                      value={reason}
                      checked={selectedReason === reason}
                      onChange={() => setSelectedReason(reason)}
                      className="accent-accent-deep"
                    />
                    <span className="text-sm">{t(REASON_KEY[reason])}</span>
                  </label>
                ))}
              </fieldset>
              <textarea
                className="w-full resize-none rounded-xl border border-text-4/30 bg-transparent px-4 py-3 text-sm placeholder:text-text-4 focus:outline-none"
                rows={3}
                placeholder={t('safety.detail_placeholder')}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                maxLength={500}
              />
            </div>
            <DrawerFooter>
              <Button
                className="w-full"
                onClick={handleReportSubmit}
                disabled={!selectedReason || submitting}
              >
                {t('safety.report')}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setView('menu')}>
                {t('safety.cancel')}
              </Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
