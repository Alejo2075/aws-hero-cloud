import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { View } from '@hero-cloud/presentation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/pixelact-ui/alert';
import { Badge } from '@/components/ui/pixelact-ui/badge';
import { Button } from '@/components/ui/pixelact-ui/button';
import { Card, CardContent } from '@/components/ui/pixelact-ui/card';
import { Checkbox } from '@/components/ui/pixelact-ui/checkbox';
import { Label } from '@/components/ui/pixelact-ui/label';
import { Spinner } from '@/components/ui/pixelact-ui/spinner';
import { ApiFailure, SessionEnded, get, post, startSession, upload } from './api.js';
import { ViewBlocks } from './ViewBlocks.js';
import { Field, PixelSelect, Title } from './fields.js';

const BUDGET_EMAIL = 'BUDGET_ALERT_EMAIL';
const STEPS = ['choose', 'review', 'approve', 'progress', 'result'] as const;
type Step = (typeof STEPS)[number];

interface Question {
  id: string;
  options: string[];
  label: string;
}
interface Plan {
  planId: string;
  digest: string;
  blocked: boolean;
  preview: boolean;
  destroy: boolean;
  view: View;
  inputs: { name: string; kind: string }[];
}
interface Analysis {
  analysisId: string;
  view: View;
  questions: Question[];
}
interface Outcome {
  view: View;
  deploymentId: string;
  destroyed: boolean;
}
type Source = { path: string } | { uploadId: string };

const readPrefs = (): { l?: string; v?: string } => {
  try {
    return JSON.parse(localStorage.getItem('hero-studio') ?? '{}') as { l?: string; v?: string };
  } catch {
    return {};
  }
};

export function App() {
  const [ready, setReady] = useState(false);
  const [ended, setEnded] = useState(false);
  const [locale, setLocale] = useState('en');
  const [level, setLevel] = useState('simple');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [step, setStep] = useState<Step>('choose');
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState('');
  const [zip, setZip] = useState<File | undefined>();
  const [source, setSource] = useState<Source | undefined>();
  const [analysis, setAnalysis] = useState<Analysis | undefined>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Plan | undefined>();
  const [runId, setRunId] = useState<string | undefined>();
  const [log, setLog] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | undefined>();
  const [email, setEmail] = useState('');
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const main = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const live = useRef<HTMLParagraphElement>(null);

  const t = useCallback(
    (key: string, params: Record<string, string> = {}): string =>
      (labels[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? ''),
    [labels],
  );

  const announce = (text: string): void => {
    if (live.current !== null) live.current.textContent = text;
  };

  /** Runs an action and shows what went wrong in the person's words. */
  const guarded = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      if (cause instanceof SessionEnded) setEnded(true);
      else setError(cause instanceof ApiFailure ? cause.message : '');
    } finally {
      setBusy(false);
      if (live.current !== null) live.current.textContent = '';
    }
  }, []);

  const go = (next: Step): void => {
    setStep(next);
    setError(undefined);
    setNotice(undefined);
    queueMicrotask(() => main.current?.focus());
  };

  // ---- loading ---------------------------------------------------------------------------

  useEffect(() => {
    void (async () => {
      try {
        const session = await startSession();
        const saved = readPrefs();
        setLocale(saved.l === 'en' || saved.l === 'es' ? saved.l : session.locale);
        setLevel(
          saved.v === 'simple' || saved.v === 'guided' || saved.v === 'expert'
            ? saved.v
            : session.level,
        );
        setReady(true);
      } catch {
        setEnded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    void get<{ messages: Record<string, string> }>(
      `/api/text?locale=${locale}&level=${level}`,
    ).then(
      ({ messages }) => {
        setLabels(messages);
        document.documentElement.lang = locale;
        document.title = messages.title ?? 'Hero Cloud Studio';
      },
      () => {
        setEnded(true);
      },
    );
  }, [ready, locale, level]);

  const savePrefs = (l: string, v: string): void => {
    try {
      localStorage.setItem('hero-studio', JSON.stringify({ l, v }));
    } catch {
      // Storage may be blocked; the choice just does not persist.
    }
  };

  // ---- actions ---------------------------------------------------------------------------

  const makePlan = useCallback(
    async (analysisId: string, given: Record<string, string>): Promise<void> => {
      const body = await post<Plan>('/api/plan', {
        analysisId,
        answers: Object.fromEntries(Object.entries(given).filter(([, v]) => v !== '')),
        level,
        locale,
      });
      setPlan(body);
      setConfirmed(false);
      go('approve');
    },
    [level, locale],
  );

  const analyze = useCallback(
    async (from: Source): Promise<void> => {
      const body = await post<Analysis>('/api/analyze', { ...from, level, locale });
      setAnalysis(body);
      setAnswers({});
      go('review');
    },
    [level, locale],
  );

  const finishRun = useCallback(
    async (id: string): Promise<void> => {
      for (;;) {
        const run = await get<{
          state: string;
          view?: View;
          deploymentId?: string;
          destroyed: boolean;
          error?: { message: string };
        }>(`/api/runs/${id}?level=${level}&locale=${locale}`);
        if (run.state === 'running') {
          await new Promise((done) => setTimeout(done, 1000));
          continue;
        }
        if (run.error !== undefined)
          throw new ApiFailure({ code: 'deployment.failed', message: run.error.message });
        if (run.view !== undefined && run.deploymentId !== undefined) {
          setOutcome({ view: run.view, deploymentId: run.deploymentId, destroyed: run.destroyed });
          go('result');
        }
        return;
      }
    },
    [level, locale],
  );

  // Progress arrives as server-sent events; when they end the final result is fetched.
  useEffect(() => {
    if (runId === undefined || step !== 'progress') return;
    const events = new EventSource(`/api/runs/${runId}/events`);
    const done = (): void => {
      events.close();
      void guarded(() => finishRun(runId));
    };
    events.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as { type: string; label?: string };
      if (event.type === 'end') done();
      else if (event.label !== undefined) {
        const label = event.label;
        setLog((lines) => [...lines, label]);
      }
    };
    events.onerror = done;
    return () => {
      events.close();
    };
  }, [runId, step, guarded, finishRun]);

  // Changing the language or level redraws what is on screen in the new words.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!ready) return;
    if (step === 'review' && source !== undefined) void guarded(() => analyze(source));
    else if (step === 'approve' && analysis !== undefined && plan !== undefined && !plan.destroy) {
      void guarded(() => makePlan(analysis.analysisId, answers));
    } else if (step === 'result' && runId !== undefined) void guarded(() => finishRun(runId));
  }, [locale, level]);

  const read = (): void => {
    void guarded(async () => {
      announce(t('loading'));
      const next: Source =
        zip === undefined ? { path: path.trim() } : { uploadId: (await upload(zip)).uploadId };
      setSource(next);
      await analyze(next);
    });
  };

  const approve = (event: FormEvent): void => {
    event.preventDefault();
    if (plan === undefined) return;
    void guarded(async () => {
      const started = await post<{ runId: string }>('/api/deploy', {
        planId: plan.planId,
        approvedDigest: plan.digest,
        confirmed,
        email,
        secrets,
        level,
        locale,
      });
      // The secrets are on their way; the page does not keep them.
      setSecrets({});
      setLog([]);
      setRunId(started.runId);
      go('progress');
    });
  };

  const checkAgain = (id: string): void => {
    void guarded(async () => {
      const { view } = await post<{ view: View }>('/api/health', {
        deploymentId: id,
        level,
        locale,
      });
      setOutcome((o) => (o === undefined ? o : { ...o, view }));
      announce(view.title);
    });
  };

  const destroy = (id: string): void => {
    void guarded(async () => {
      setPlan(await post<Plan>('/api/destroy-plan', { deploymentId: id, level, locale }));
      setConfirmed(false);
      go('approve');
    });
  };

  const startOver = (): void => {
    setOutcome(undefined);
    setPlan(undefined);
    setAnalysis(undefined);
    setSource(undefined);
    go('choose');
  };

  // ---- screens ---------------------------------------------------------------------------

  if (ended) {
    return (
      <Alert variant="destructive" font="normal" role="alert">
        <AlertDescription>
          {labels['session.ended'] ??
            'This Studio session ended. Run hero-cloud studio again to open a new one.'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <a className="skip" href="#main">
        {t('skip')}
      </a>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Title as="h1" size="lg">
            {t('title')}
          </Title>
          <p className="mt-3 text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-2">
          <Label htmlFor="locale" className="mb-0 text-xs">
            {t('language')}
          </Label>
          <PixelSelect
            id="locale"
            value={locale}
            onChange={(e) => {
              setLocale(e.target.value);
              savePrefs(e.target.value, level);
            }}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </PixelSelect>
          <Label htmlFor="level" className="mb-0 text-xs">
            {t('level')}
          </Label>
          <PixelSelect
            id="level"
            value={level}
            onChange={(e) => {
              setLevel(e.target.value);
              savePrefs(locale, e.target.value);
            }}
          >
            {(['simple', 'guided', 'expert'] as const).map((v) => (
              <option key={v} value={v}>
                {t(`level.${v}`)}
              </option>
            ))}
          </PixelSelect>
        </div>
      </header>
      <nav aria-label="Steps" className="my-6">
        <ol className="flex flex-wrap gap-3">
          {STEPS.map((s) => (
            <li key={s}>
              <Badge
                variant={s === step ? 'default' : 'outline'}
                aria-current={s === step ? 'step' : undefined}
              >
                {t(`step.${s}`)}
              </Badge>
            </li>
          ))}
        </ol>
      </nav>
      <main id="main" tabIndex={-1} ref={main} className="outline-none">
        {notice !== undefined && (
          <Alert font="normal" role="status" className="my-4!">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {error !== undefined && (
          <Alert variant="destructive" font="normal" role="alert" className="my-4!">
            <AlertTitle>{t('error.heading')}</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  setError(undefined);
                }}
              >
                {t('error.try-again')}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {step === 'choose' && (
          <section className="space-y-4">
            <Title as="h2">{t('choose.heading')}</Title>
            <p>{t('choose.intro')}</p>
            <Field
              id="path"
              label={t('choose.path')}
              hint={t('choose.path-hint')}
              value={path}
              onChange={(value) => {
                setPath(value);
              }}
            />
            <p className="text-muted-foreground">{t('choose.or')}</p>
            <input
              ref={fileInput}
              id="zip"
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                setZip(e.target.files?.[0]);
              }}
            />
            <div>
              <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                {zip === undefined ? t('choose.upload') : zip.name}
              </Button>
            </div>
            <div>
              <Button disabled={busy || (zip === undefined && path.trim() === '')} onClick={read}>
                {t('choose.analyze')}
              </Button>
            </div>
          </section>
        )}

        {step === 'review' && analysis !== undefined && (
          <>
            <ViewBlocks view={analysis.view} />
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void guarded(() => makePlan(analysis.analysisId, answers));
              }}
            >
              {analysis.questions.length > 0 && <Title as="h2">{t('questions.heading')}</Title>}
              {analysis.questions.map((q) =>
                q.options.length > 0 ? (
                  <div key={q.id}>
                    <Label htmlFor={`q-${q.id}`} className="font-sans! text-sm leading-relaxed">
                      {q.label}
                    </Label>
                    <PixelSelect
                      id={`q-${q.id}`}
                      value={answers[q.id] ?? ''}
                      onChange={(e) => {
                        setAnswers({ ...answers, [q.id]: e.target.value });
                      }}
                    >
                      <option value="" />
                      {q.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </PixelSelect>
                  </div>
                ) : (
                  <Field
                    key={q.id}
                    id={`q-${q.id}`}
                    label={q.label}
                    value={answers[q.id] ?? ''}
                    onChange={(value) => {
                      setAnswers({ ...answers, [q.id]: value });
                    }}
                  />
                ),
              )}
              <Button type="submit" disabled={busy}>
                {t('questions.make-plan')}
              </Button>
            </form>
          </>
        )}

        {step === 'approve' && plan !== undefined && (
          <>
            <ViewBlocks view={plan.view} />
            {plan.preview && (
              <Alert
                font="normal"
                role="alert"
                className="my-4! bg-warning text-warning-foreground"
              >
                <AlertDescription className="text-current">{t('review.preview')}</AlertDescription>
              </Alert>
            )}
            {!plan.preview && plan.blocked && (
              <Alert variant="destructive" font="normal" role="alert" className="my-4!">
                <AlertDescription>{t('review.blocked')}</AlertDescription>
              </Alert>
            )}
            {!plan.preview && !plan.blocked && (
              <Card font="normal" className="my-8" role="group" aria-labelledby="decision">
                <CardContent>
                  <form className="space-y-4" onSubmit={approve}>
                    <Title as="h2" id="decision">
                      {t('approve.heading')}
                    </Title>
                    <p>{t('approve.statement')}</p>
                    {plan.inputs.map((input) =>
                      input.name === BUDGET_EMAIL ? (
                        <Field
                          key={input.name}
                          id="email"
                          type="email"
                          autoComplete="email"
                          label={t('approve.email')}
                          hint={t('approve.email-hint')}
                          value={email}
                          onChange={(value) => {
                            setEmail(value);
                          }}
                        />
                      ) : input.kind === 'secret' ? (
                        <Field
                          key={input.name}
                          id={`s-${input.name}`}
                          type="password"
                          autoComplete="off"
                          label={t('approve.secret', { name: input.name })}
                          hint={t('approve.secret-hint')}
                          value={secrets[input.name] ?? ''}
                          onChange={(value) => {
                            setSecrets({ ...secrets, [input.name]: value });
                          }}
                        />
                      ) : null,
                    )}
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="confirm"
                        checked={confirmed}
                        onCheckedChange={(value) => {
                          setConfirmed(value === true);
                        }}
                        className="mt-1 shrink-0"
                      />
                      <Label
                        htmlFor="confirm"
                        className="mb-0 font-sans! text-base font-semibold leading-snug"
                      >
                        {t('approve.confirm')}
                      </Label>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" variant="success" disabled={!confirmed || busy}>
                        {t('approve.button')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          go('choose');
                          setNotice(t('approve.declined'));
                        }}
                      >
                        {t('approve.decline')}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {step === 'progress' && (
          <section className="space-y-4">
            <Title as="h2">{t('progress.heading')}</Title>
            <p className="flex items-center gap-3">
              <Spinner aria-hidden="true" />
              {t('progress.working')}
            </p>
            <ol className="space-y-1" aria-live="polite">
              {log.map((line, i) => (
                <li key={i} className="border-b border-border py-1">
                  {line}
                </li>
              ))}
            </ol>
          </section>
        )}

        {step === 'result' && outcome !== undefined && (
          <>
            <ViewBlocks view={outcome.view} />
            {!outcome.destroyed && (
              <>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      checkAgain(outcome.deploymentId);
                    }}
                  >
                    {t('result.check-again')}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      destroy(outcome.deploymentId);
                    }}
                  >
                    {t('result.destroy')}
                  </Button>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{t('result.destroy-note')}</p>
              </>
            )}
            <div className="mt-6">
              <Button onClick={startOver}>{t('result.start-over')}</Button>
            </div>
          </>
        )}
      </main>
      <p className="sr-only" role="status" aria-live="polite" ref={live} />
    </div>
  );
}
