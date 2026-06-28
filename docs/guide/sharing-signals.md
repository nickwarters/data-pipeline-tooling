# Sharing Signals Between Components

Create shared signals in the parent route or page function, then pass the signal
to plain child functions as an explicit prop.

## Quick Reference

```js
import { h } from '../lib/html.js';
import { signal } from '../lib/signal.js';
import { reactive } from '../lib/view.js';

export function CaseReviewPage({ questions, computeOutcome }) {
  const answers = signal({});

  return h(
    'main',
    {},
    QuestionList({ questions, answers }),
    Outcome({ answers, computeOutcome })
  );
}
```

Any child that calls `answers.set(...)` updates every reactive child that reads
`answers.get()`.

## The Pattern

Signals are plain objects with `{ get, set }`.

Create the signal at the level that owns the state:

```js
const answers = signal(caseRow.answers ?? {});
```

Pass that exact signal to children that need to read or write it:

```js
QuestionList({ questions, answers });
Summary({ answers, computeOutcome });
```

This keeps shared state explicit without a global store.

## When To Share

| Situation                                                       | Approach                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| A value is only relevant to one component                       | Create the signal inside that function component               |
| Two sibling components need to read and/or write the same value | Create the signal in their parent and pass it to both          |
| A child needs to write back to a parent                         | Pass the writable signal or a specific callback such as `save` |

## Worked Example

```js
export function QuestionList({ questions, answers }) {
  return h(
    'section',
    {},
    questions.map((question) =>
      Question({
        question,
        value: answers.get()[question.id]?.value ?? '',
        onAnswer: (value) => {
          answers.set({
            ...answers.get(),
            [question.id]: { value },
          });
        },
      })
    )
  );
}

export function Outcome({ answers, computeOutcome }) {
  return reactive(() => {
    const result = computeOutcome(answers.get());
    return h('p', {}, result.wording);
  });
}
```

`QuestionList` and `Outcome` never import each other. The shared signal is their
only shared interface.

## Persistence

Keep persistence explicit. If a component needs to save after updating a shared
signal, pass a callback:

```js
QuestionList({
  questions,
  answers,
  onAnswer: ({ questionId, value }) => {
    const next = { ...answers.get(), [questionId]: { value } };
    answers.set(next);
    saveQueue.enqueue(caseId, 'answers', next);
  },
});
```

The component stays simple: it calls `onAnswer`, and the parent owns both shared
state and persistence.
