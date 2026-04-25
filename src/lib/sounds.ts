
export type SoundEffect = 'click' | 'success' | 'delete' | 'error';

const sounds: Record<SoundEffect, string> = {
  click: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
  success: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  delete: '', // Removed crying sound
  error: 'https://assets.mixkit.co/active_storage/sfx/2572/2572-preview.mp3',
};

export const playSound = (effect: SoundEffect, enabled: boolean) => {
  if (!enabled) return;
  try {
    const audio = new Audio(sounds[effect]);
    audio.volume = 0.5;
    audio.play().catch(e => console.warn('Audio play failed', e));
  } catch (e) {
    console.warn('Audio failed to initialize', e);
  }
};
