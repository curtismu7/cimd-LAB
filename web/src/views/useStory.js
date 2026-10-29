import { useEffect, useState } from 'react';
import { api } from '../api.js';

// One source for the Stories tab and the Talk track tab: the server renders the story for a vertical with the customer's cast.
export function useStory(vertical) {
  const [state, setState] = useState({ story: null, failed: false });
  useEffect(() => {
    if (!vertical) return undefined;
    let live = true;
    setState({ story: null, failed: false });
    api.story(vertical).then((r) => { if (live) setState(r.ok && Array.isArray(r.data?.beats) ? { story: r.data, failed: false } : { story: null, failed: true }); });
    return () => { live = false; };
  }, [vertical]);
  return state;
}
