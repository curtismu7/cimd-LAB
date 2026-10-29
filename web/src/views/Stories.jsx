import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useStory } from './useStory.js';

// The CIMD beats retold for a vertical. All text is rendered as inert React text.
export default function Stories({ vertical, setVertical }) {
  const [verticals, setVerticals] = useState([]);
  useEffect(() => {
    let live = true;
    api.stories().then((r) => { if (live && r.ok && Array.isArray(r.data?.verticals)) setVerticals(r.data.verticals); });
    return () => { live = false; };
  }, []);
  const { story, failed } = useStory(vertical);
  return (
    <div className="view stories">
      <h2>Stories</h2>
      <p>The same nine beats as the talk track, retold for a made-up company. Every name here is fictional.</p>
      <fieldset className="story-pick">
        <legend>Vertical</legend>
        {verticals.map((v) => (
          <label className="inline" key={v.id}>
            <input type="radio" name="vertical" checked={vertical === v.id} onChange={() => setVertical(v.id)} /> {v.label}
          </label>
        ))}
      </fieldset>
      {failed ? <p role="alert" className="tone-bad">The story could not be loaded.</p> : null}
      {story ? (
        <article aria-label={`Story: ${story.label}`}>
          {story.beats.map((beat) => (
            <section className="story-beat" key={beat.id}>
              <h3>{beat.title}</h3>
              <p>{beat.story}</p>
            </section>
          ))}
        </article>
      ) : null}
    </div>
  );
}
