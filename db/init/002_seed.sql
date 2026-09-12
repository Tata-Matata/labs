INSERT INTO labs (id, title, description, instructions) VALUES
  ('k8s-basics', 'Kubernetes Basics', 'Pods, Deployments, Services', 'Create a Pod named nginx running the nginx image, then expose it with a Service.'),
  ('terraform-intro', 'Terraform Intro', 'Providers, Resources, State', 'Write a Terraform configuration that provisions a local file resource.'),
  ('linux-fundamentals', 'Linux Fundamentals', 'Filesystem, Permissions, Processes', 'Create a directory, set permissions to 750, and list running processes.'),
  ('k8s-networking', 'Kubernetes Networking', 'Ingress, NetworkPolicy, DNS', 'Configure an Ingress resource routing traffic to two backend services.'),
  ('terraform-modules', 'Terraform Modules', 'Reusable Infrastructure', 'Refactor a Terraform config into a reusable module.'),
  ('linux-scripting', 'Linux Scripting', 'Bash, Cron, Automation', 'Write a bash script and schedule it with cron to run every 5 minutes.')
ON CONFLICT (id) DO NOTHING;
