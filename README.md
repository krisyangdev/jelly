# Jelly Zoo

A knitted basket packed with chubby needle-felted animals. Everything is soft-body: poke, squash, drag, pet and toss them.

**Play:** [jelly.krisyang.dev](https://jelly.krisyang.dev)

![Day](docs/day.jpg)
![Night](docs/night.jpg)

## Controls

- Click an animal to poke it, press and hold to squash, drag to stretch and throw.
- Stroke an animal without pressing to pet it.
- Hold on the empty floor to rain more animals.
- Drag the rim or use the arrow keys to tilt the basket. Space shakes it.
- The room follows your clock: a sunny window by day, a desk lamp at night. Force one with `?time=day` or `?time=night`.

## Run locally

```bash
npm install
npm run dev
```

Built with three.js and Vite. Physics is position-based shape matching; sounds are synthesized with WebAudio. See [SPEC.md](SPEC.md) for how it works.

## License

MIT. By [Kris Yang](https://krisyang.dev).
