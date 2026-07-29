# Repository layout

```
md2pdf/
├── .github/workflows/deploy.yml
├── scripts/
│   └── subset-fonts.md
├── static/
│   ├── .nojekyll
│   └── fonts/
│       ├── inter/{Regular,Bold}.ttf
│       └── manifest.json
└── src/
    ├── app.html
    └── lib/
        ├── markdown/
        │   ├── parse.ts
        │   └── pagebreak.ts
        └── pdf/
            └── blocks.ts
```

Trees also appear outside fences: ├── │ └── ┬ ┴ ┼ ┤ ┌ ┐ ┘
