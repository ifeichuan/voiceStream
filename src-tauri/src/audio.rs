pub fn normalize_f32_sample(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16
}

pub fn normalize_u16_sample(sample: u16) -> i16 {
    (sample as i32 - 32_768) as i16
}

pub fn pcm_i16_to_f32(sample: i16) -> f32 {
    sample as f32 / i16::MAX as f32
}

pub fn remix_channels(samples: &[f32], source_channels: u16, target_channels: u16) -> Vec<f32> {
    if source_channels == target_channels {
        return samples.to_vec();
    }

    let source_channels = source_channels as usize;
    let target_channels = target_channels as usize;

    if source_channels == 0 || target_channels == 0 {
        return Vec::new();
    }

    let mut remixed = Vec::with_capacity(samples.len() / source_channels * target_channels);

    for frame in samples.chunks_exact(source_channels) {
        if target_channels == 1 {
            remixed.push(frame.iter().copied().sum::<f32>() / source_channels as f32);
            continue;
        }

        if source_channels == 1 {
            remixed.extend(std::iter::repeat_n(frame[0], target_channels));
            continue;
        }

        for channel in 0..target_channels {
            remixed.push(frame[channel.min(source_channels - 1)]);
        }
    }

    remixed
}

pub fn resample_interleaved(
    samples: &[f32],
    channels: u16,
    source_rate: u32,
    target_rate: u32,
) -> Vec<f32> {
    if source_rate == target_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let channels = channels as usize;
    if channels == 0 {
        return Vec::new();
    }

    let source_frames = samples.len() / channels;
    if source_frames <= 1 {
        return samples.to_vec();
    }

    let target_frames =
        ((source_frames as f64 * target_rate as f64) / source_rate as f64).round() as usize;
    let last_frame = source_frames - 1;
    let mut resampled = Vec::with_capacity(target_frames * channels);

    for target_index in 0..target_frames {
        let source_position = target_index as f64 * source_rate as f64 / target_rate as f64;
        let base_index = source_position.floor() as usize;
        let next_index = (base_index + 1).min(last_frame);
        let fraction = (source_position - base_index as f64) as f32;

        for channel in 0..channels {
            let base_sample = samples[base_index * channels + channel];
            let next_sample = samples[next_index * channels + channel];
            resampled.push(base_sample + (next_sample - base_sample) * fraction);
        }
    }

    resampled
}

pub fn convert_chunk_to_pcm16(
    samples: &[i16],
    sample_rate: u32,
    channels: u16,
    target_sample_rate: u32,
    target_channels: u16,
) -> Vec<u8> {
    let normalized: Vec<f32> = samples.iter().copied().map(pcm_i16_to_f32).collect();
    let remixed = remix_channels(&normalized, channels, target_channels);
    let resampled =
        resample_interleaved(&remixed, target_channels, sample_rate, target_sample_rate);

    resampled
        .into_iter()
        .map(normalize_f32_sample)
        .flat_map(|sample| sample.to_le_bytes())
        .collect()
}
