-- ════════════════════════════════════════════════════════════════════════
-- PitchIQ MVP — 002_storage_buckets.sql (additive, Day 1)
-- Private buckets used by edge functions. Objects live under "<user_id>/...".
--   raw-video     : optional raw drill clips, purged at raw_video_expires_at (≤ 90 d)
--   debrief-audio : TTS debriefs written by voice-debrief (service role)
-- ════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('raw-video', 'raw-video', false, 104857600, array['video/mp4', 'video/quicktime']),
  ('debrief-audio', 'debrief-audio', false, 5242880, array['audio/mpeg'])
on conflict (id) do nothing;

-- Owners may read their own objects in both buckets.
create policy storage_owner_read on storage.objects
  for select using (
    bucket_id in ('raw-video', 'debrief-audio')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owners may upload/delete their own raw video; debrief audio is service-role only.
create policy storage_raw_video_owner_insert on storage.objects
  for insert with check (
    bucket_id = 'raw-video' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy storage_raw_video_owner_delete on storage.objects
  for delete using (
    bucket_id = 'raw-video' and (storage.foldername(name))[1] = auth.uid()::text
  );
