import { useStory } from './useStory.js';

// Presenter notes drawn from the same data as the Stories tab (server-rendered, so the customer's words apply).
export default function TalkTrack({ vertical }) {
  const { story, failed } = useStory(vertical);
  return (
    <div className="view talk">
      <h2>Talk track</h2>
      {failed ? <p role="alert" className="tone-bad">The talk track could not be loaded.</p> : null}
      {story ? (
        <>
          {story.intro.map((text, i) => <p key={i}>{text}</p>)}
          <p className="hint">Told as: {story.label}. Pick another on the Stories tab.</p>
          {story.beats.map((beat) => (
            <section key={beat.id}>
              <h3>{beat.title}</h3>
              <ul>{beat.points.map((point, i) => <li key={i}>{point}</li>)}</ul>
            </section>
          ))}
        </>
      ) : null}
    </div>
  );
}
