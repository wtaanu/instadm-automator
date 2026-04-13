# Render Deployment Checklist

## Goal
Deploy the API first to get a public webhook URL for Meta, then deploy the web app.

## Files
- Render config: [render.yaml](C:/Users/pawan/Documents/Claude/Projects/insta-automation/Code/render.yaml)

## 1. Push This Project To GitHub
Render deploys from a Git repo, so make sure this project is pushed to GitHub first.

## 2. Create a Render Account
Open [https://render.com](https://render.com) and sign in.

## 3. Create Services From Blueprint
In Render:
1. Click `New`
2. Choose `Blueprint`
3. Select the GitHub repo for this project
4. Render will detect `render.yaml`

This will create:
- `insta-automation-api`
- `insta-automation-web`

## 4. Fill API Environment Variables
In Render, for the API service, set:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_REDIRECT_URI`
- `OPENAI_API_KEY`

Recommended deployed callback value:
- `META_REDIRECT_URI=https://insta-automation-api.onrender.com/api/instagram/callback`

## 5. Fill Web Environment Variables
In Render, for the web service, set:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

`VITE_API_BASE_URL` is already configured in `render.yaml`.

## 6. Update Meta After Deploy
Once the API is live, use:
- Webhook URL:
  `https://insta-automation-api.onrender.com/api/meta/webhook`
- OAuth callback:
  `https://insta-automation-api.onrender.com/api/instagram/callback`

Update these in your Meta app settings.

## 7. Verify Deployment
After deploy:
- API health:
  `https://insta-automation-api.onrender.com/health`
- Web app:
  `https://insta-automation-web.onrender.com`

## 8. Important Security Reminder
Your current local env has secrets that were shared earlier in chat.
Before production deploy, rotate:
- Meta app secret
- OpenAI API key
- Supabase service role key
