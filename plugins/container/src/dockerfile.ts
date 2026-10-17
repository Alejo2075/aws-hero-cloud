import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';

const EXPOSE = /^\s*EXPOSE\s+(\d{1,5})(?:\/(?:tcp|udp))?/im;

/**
 * An application that ships a Dockerfile says how it wants to run. When there is no other sign of
 * what the application is (no `package.json`), the Dockerfile alone describes a web service that
 * listens on the port it exposes. Otherwise it is only noted: the simpler way to run the
 * application wins, and a person can still choose to run the container.
 */
export const dockerfileDetector = defineDetector({
  id: 'container/dockerfile',
  description: 'Applications that ship a Dockerfile',
  async detect(context) {
    if (!context.has('Dockerfile')) return emptyFinding;
    const text = (await context.readText('Dockerfile')) ?? '';
    const exposed = EXPOSE.exec(text)?.[1];
    const port = exposed === undefined ? undefined : Number(exposed);
    const validPort = port !== undefined && port >= 1 && port <= 65535 ? port : undefined;

    const evidence = ['file:Dockerfile'];
    const detections = [{ capability: 'container-image', confidence: 0.9, evidence }];
    const note = {
      kind: 'extension',
      key: 'x-container',
      value: { dockerfile: 'Dockerfile' },
    } as const;

    if (context.has('package.json')) return { detections, contributions: [note], questions: [] };
    return {
      detections: [
        ...detections,
        {
          capability: 'http-service',
          confidence: 0.6,
          evidence: [...evidence, ...(validPort === undefined ? [] : ['source:EXPOSE'])],
        },
      ],
      contributions: [
        note,
        {
          kind: 'service',
          value: {
            id: 'app',
            type: 'http',
            runtime: 'container',
            ...(validPort === undefined ? {} : { port: validPort }),
          },
          confidence: 0.6,
        },
      ],
      questions:
        validPort === undefined
          ? [
              {
                id: 'service.port-unknown',
                code: 'service.port-unknown',
                params: { service: 'app' },
              },
            ]
          : [],
    };
  },
});
