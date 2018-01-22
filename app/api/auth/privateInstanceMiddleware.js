import settings from '../settings';

export default function (req, res, next) {
  return settings.get()
  .then((result) => {
    if (result.private && !req.user) {
      res.status(401);
      res.json({error: 'Unauthorized'});
      return;
    }
    next();
  });
}
