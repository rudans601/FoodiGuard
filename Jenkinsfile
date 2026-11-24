stage('Test backend, mobile and infrastructure') {
  sh 'buildctl build --frontend dockerfile.v0 --local context=. --local dockerfile=local --opt filename=Tests.Dockerfile'
}
stage('Build and publish local images') {
  sh '''
    set -eu
    for component in api web; do
      context=.
      if [ "$component" = api ]; then context=backend; fi
      buildctl build --frontend dockerfile.v0 --local context="$context" --local dockerfile="$context" \\
        --output "type=image,name=foodiguard-registry:5000/foodiguard-$component:$REVISION,push=true,registry.insecure=true"
    done
  '''
}
stage('Publish Helm release to local Git') {
  sh 'bash local/scripts/promote.sh'
}
