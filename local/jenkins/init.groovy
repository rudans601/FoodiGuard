import jenkins.model.Jenkins
import hudson.model.Item
import hudson.model.ParametersDefinitionProperty
import hudson.model.StringParameterDefinition
import hudson.security.HudsonPrivateSecurityRealm
import hudson.security.GlobalMatrixAuthorizationStrategy
import jenkins.security.ApiTokenProperty
import org.jenkinsci.plugins.workflow.job.WorkflowJob
import org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition

def j = Jenkins.get()
def realm = j.securityRealm instanceof HudsonPrivateSecurityRealm ? j.securityRealm : new HudsonPrivateSecurityRealm(false)
if (hudson.model.User.getById('local-admin', false)?.getProperty(HudsonPrivateSecurityRealm.Details) == null) {
  realm.createAccount('local-admin', new File('/run/secrets/admin-password').text.trim())
}
def robot = hudson.model.User.getById('foodiguard-ci', false)
if (robot?.getProperty(HudsonPrivateSecurityRealm.Details) == null) {
  robot = realm.createAccount('foodiguard-ci', UUID.randomUUID().toString())
}
j.setSecurityRealm(realm)
def permissions = new GlobalMatrixAuthorizationStrategy()
permissions.add(Jenkins.ADMINISTER, 'local-admin')
permissions.add(Jenkins.READ, 'foodiguard-ci')
permissions.add(Item.READ, 'foodiguard-ci')
permissions.add(Item.BUILD, 'foodiguard-ci')
j.setAuthorizationStrategy(permissions)
j.setNumExecutors(1)
def tokenFile = new File(j.rootDir, 'secrets/foodiguard-ci-token')
if (!tokenFile.exists()) {
  tokenFile.text = robot.getProperty(ApiTokenProperty).tokenStore.generateNewToken('local-workflow').plainValue
  robot.save()
}
def job = j.getItem('foodiguard-local') ?: j.createProject(WorkflowJob, 'foodiguard-local')
job.addProperty(new ParametersDefinitionProperty(new StringParameterDefinition('REVISION', '', 'Git commit SHA')))
job.setConcurrentBuild(false)
job.definition = new CpsFlowDefinition('''
node {
  if (!(params.REVISION ==~ /[0-9a-f]{40}/)) { error('Invalid source revision') }
  stage('Checkout') {
    deleteDir()
    sh 'git init -q && git fetch -q file:///source.git refs/heads/releases/$REVISION && git checkout -q --detach FETCH_HEAD && test "$(git rev-parse HEAD)" = "$REVISION"'
  }
  load 'Jenkinsfile'
}
''', true)
job.save()
j.save()
