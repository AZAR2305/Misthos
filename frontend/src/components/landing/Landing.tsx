"use client";

import { Nav } from "./Nav";
import { Hero } from "./Hero";
import { Features } from "./Features";
import { Steps } from "./Steps";
import { Who } from "./Who";
import { Agents } from "./Agents";
import { Evidence } from "./Evidence";
import { Final } from "./Final";
import { useSceneInput } from "./scene-store";

/** A plain, light page. The only motion is the agents: they follow the cursor, and this keeps the shared pointer up to date. */
export function Landing() {
  useSceneInput();
  return (
    <div className="landing">
      <Nav />
      <main>
        <Hero />
        <Features />
        <Steps />
        <Who />
        <Agents />
        <Evidence />
        <Final />
      </main>
    </div>
  );
}
