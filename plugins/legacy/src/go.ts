import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import type { OpenQuestion } from '@hero-cloud/core';
import { HEALTH_ROUTE, portIn, text } from './shared.js';

const LISTEN = /ListenAndServe(?:TLS)?\(\s*"[^":]*:(\d{2,5})"/;

/** Go web servers built on the standard library or a common router. */
export const goDetector = defineDetector({
  id: 'legacy/go',
  description: 'Go web applications',
  async detect(context) {
    if (!context.has('go.mod')) return emptyFinding;
    const sources = context.files
      .map((f) => f.path)
      .filter((p) => /^(?:[^/]+\/)?[^/]+\.go$/.test(p) && !p.endsWith('_test.go'))
      .slice(0, 20);
    let port: number | undefined;
    let health: string | undefined;
    let serves = false;
    for (const file of sources) {
      const code = (await text(context, file, 128 * 1024)) ?? '';
      if (
        /net\/http|gin-gonic\/gin|labstack\/echo|go-chi\/chi|gofiber\/fiber|gorilla\/mux/.test(code)
      )
        serves = true;
      port = port ?? portIn(code, LISTEN);
      health = health ?? HEALTH_ROUTE.exec(code)?.[1];
    }
    if (!serves) return emptyFinding;
    const questions: OpenQuestion[] =
      port === undefined
        ? [{ id: 'service.port-unknown', code: 'service.port-unknown', params: { service: 'web' } }]
        : [];
    return {
      detections: [
        {
          capability: 'http-service',
          confidence: 0.8,
          evidence: ['file:go.mod', ...(port === undefined ? [] : ['source:listen-port'])],
        },
      ],
      contributions: [
        {
          kind: 'service',
          value: {
            id: 'web',
            type: 'http',
            runtime: 'go',
            ...(port === undefined ? {} : { port }),
            ...(health === undefined ? {} : { healthPath: health }),
          },
          confidence: 0.8,
        },
      ],
      questions,
    };
  },
});
