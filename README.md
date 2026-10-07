# Press list checker

A Cursor BDK agent. Paste journalists as first name, last name, and outlet. It stores the list, checks up to 8 people at a time against public bylines, staff pages, LinkedIn, and X, and saves a verdict for each person.

Verdicts are Still there, Moved, Left journalism, or Uncertain, each with a confidence score and sources. Ask it for a CSV when you want the list exported.

## Run

```bash
npm install
npx bdk dev
```

Open the playground URL that `bdk dev` prints. Paste a list, ask it to check the list, then ask for a CSV.

Model turns need a Cursor credential (`npx bdk login`).

## Check the project

```bash
npm test
npm run check
npx bdk validate --dir .
npx bdk eval --dir . --list
```
