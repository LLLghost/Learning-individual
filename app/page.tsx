'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';

type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(input: unknown): unknown;
};

type ModelContext = {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): void | Promise<void>;
};

const progressKey = 'server-infrastructure-selfstudy-v6';

export default function Home() {
  const courseFrame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!modelContext?.registerTool) return;

    const lifecycle = new AbortController();
    const getCourseWindow = () => {
      const courseWindow = courseFrame.current?.contentWindow;
      if (!courseWindow) throw new Error('Курс ещё не загружен.');
      return courseWindow;
    };

    const readProgress = () => {
      const raw = getCourseWindow().localStorage.getItem(progressKey);
      const saved = raw ? JSON.parse(raw) : null;
      const records = saved?.records && typeof saved.records === 'object' ? saved.records : {};
      const history = Array.isArray(saved?.history) ? saved.history : [];
      return {
        schema: saved?.schema ?? 'course-study-progress',
        answeredChecks: Object.keys(records).length,
        correctChecks: Object.values(records).filter(
          (record) => Boolean((record as { correct?: boolean })?.correct),
        ).length,
        programmingTestsPassed: Number(saved?.practice?.passed ?? 0),
        bestFinalExam: Math.max(0, ...history.map((attempt: { correct?: number }) => Number(attempt.correct ?? 0))),
      };
    };

    const tools: WebMcpTool[] = [
      {
        name: 'get_course_progress',
        title: 'Показать прогресс курса',
        description: 'Возвращает краткое состояние самостоятельного обучения, сохранённое в этом браузере.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: () => readProgress(),
      },
      {
        name: 'open_course_module',
        title: 'Открыть модуль курса',
        description: 'Переходит к одному из 37 учебных модулей в видимом интерфейсе курса.',
        inputSchema: {
          type: 'object',
          properties: {
            module: { type: 'integer', minimum: 0, maximum: 36 },
          },
          required: ['module'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => {
          const value = (input as { module?: unknown })?.module;
          if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 36) {
            throw new Error('Номер модуля должен быть целым числом от 0 до 36.');
          }
          const moduleNumber = Number(value);
          const courseWindow = getCourseWindow();
          courseWindow.location.hash = `ch${String(moduleNumber).padStart(2, '0')}`;
          courseFrame.current?.focus();
          return {
            openedModule: moduleNumber,
            anchor: `ch${String(moduleNumber).padStart(2, '0')}`,
          };
        },
      },
    ];

    for (const tool of tools) {
      try {
        void Promise.resolve(modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
      } catch {
        // WebMCP is optional; the visible course remains fully functional.
      }
    }

    return () => lifecycle.abort();
  }, []);

  return (
    <main className="course-shell">
      <iframe
        ref={courseFrame}
        className="course-frame"
        src="/course.html"
        title="Серверная инфраструктура — университетский курс"
        allow="clipboard-write"
      />
      <noscript>
        <p>
          Для автоматической проверки заданий нужен JavaScript. Сам учебник можно
          <Link href="/course.html"> открыть отдельной страницей</Link>.
        </p>
      </noscript>
    </main>
  );
}
